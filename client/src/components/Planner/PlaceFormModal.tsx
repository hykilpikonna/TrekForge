import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Modal from '../shared/Modal'
import CustomSelect from '../shared/CustomSelect'
import { mapsApi } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import { useCanDo } from '../../store/permissionsStore'
import { useTripStore } from '../../store/tripStore'
import { useAddonStore } from '../../store/addonStore'
import CollectionPicker from '../Collections/CollectionPicker'
import { useToast } from '../shared/Toast'
import { Search, Paperclip, X, AlertTriangle, Loader2, Plus, Star, MapPin, Info, Accessibility, MessageSquare, Image as ImageIcon, BarChart3 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { DEFAULT_FORM, isGoogleMapsUrl, type PlaceFormData } from './PlaceFormModal.helpers'
import { getApiErrorMessage } from '../../utils/apiError'
import type { Place, Category, Assignment } from '../../types'

// The submit payload mirrors the form, but lat/lng are parsed to numbers and
// category_id is normalised, plus any files chosen before the place existed.
export interface PlaceSubmitData extends Omit<PlaceFormData, 'lat' | 'lng' | 'category_id'> {
  lat: number | null
  lng: number | null
  category_id: string | null
  _pendingFiles?: File[]
}

interface PlaceFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: PlaceSubmitData, files?: File[]) => Promise<void> | void
  place: Place | null
  prefillCoords?: { lat: number; lng: number; name?: string; address?: string; website?: string; phone?: string; osm_id?: string } | null
  tripId: number
  categories: Category[]
  onCategoryCreated: (category: { name: string; color?: string; icon?: string }) => Promise<Category> | undefined
  assignmentId: number | null
  dayAssignments?: Assignment[]
  /** Mobile keeps the untouched single-column form; desktop adds the saved-place
   *  picker column when the Collections addon is enabled. Sourced from the trip
   *  planner's matchMedia('(max-width:767px)'). */
  isMobile?: boolean
}

function cleanMapsText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function mapsTypeLabel(value: unknown): string | null {
  const text = cleanMapsText(value)
  if (!text) return null
  const cleaned = text.replace(/^SearchResult\.TYPE_/i, '').replace(/^gcid:/i, '').replace(/_/g, ' ').toLowerCase()
  return cleaned.replace(/\b\w/g, c => c.toUpperCase())
}

function uniqueMapsTexts(...values: unknown[]): string[] {
  const out: string[] = []
  for (const value of values) {
    const text = cleanMapsText(value)
    if (!text) continue
    if (out.some(existing => existing.localeCompare(text, undefined, { sensitivity: 'accent' }) === 0)) continue
    out.push(text)
  }
  return out
}

function photoUrlFromDetailsRecord(photo: any): string | null {
  if (!photo || typeof photo !== 'object') return null
  for (const key of ['url', 'photoUrl', 'src']) {
    const value = cleanMapsText(photo[key])
    if (value) return value
  }
  return null
}

function uniqueDetailPhotoUrls(...sources: Array<string | null | undefined | any[]>): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    const values = Array.isArray(source) ? source.map(item => typeof item === 'string' ? cleanMapsText(item) : photoUrlFromDetailsRecord(item)) : [cleanMapsText(source)]
    for (const value of values) {
      if (!value || seen.has(value)) continue
      seen.add(value)
      urls.push(value)
    }
  }
  return urls
}


/** Place create/edit form state: maps search + Google-URL resolve + autocomplete,
 * category creation, file attachments and submit. Keeps PlaceFormModal a thin
 * render over the form fields. */

// #1152: a manually-added place is treated as a likely duplicate of an existing
// trip place if it shares the Google Place ID, the (case-insensitive) name, or
// near-identical coordinates (~11 m). Mirrors the server-side import dedup.
const DUP_COORD_TOLERANCE = 0.0001
function findDuplicatePlace(
  form: PlaceFormData,
  places: { name?: string | null; lat?: number | null; lng?: number | null; google_place_id?: string | null }[],
): { name?: string | null } | null {
  const name = (form.name || '').trim().toLowerCase()
  const gid = (form.google_place_id || '').trim()
  const lat = form.lat ? parseFloat(form.lat) : null
  const lng = form.lng ? parseFloat(form.lng) : null
  for (const p of places || []) {
    if (gid && p.google_place_id && p.google_place_id === gid) return p
    if (name && p.name && p.name.trim().toLowerCase() === name) return p
    if (
      lat != null && lng != null && p.lat != null && p.lng != null &&
      Math.abs(Number(p.lat) - lat) <= DUP_COORD_TOLERANCE &&
      Math.abs(Number(p.lng) - lng) <= DUP_COORD_TOLERANCE
    ) return p
  }
  return null
}

function usePlaceFormModal(props: PlaceFormModalProps) {
  const {
  isOpen, onClose, onSave, place, prefillCoords, tripId, categories,
  onCategoryCreated, assignmentId, dayAssignments = [], isMobile = false,
  } = props
  const [form, setForm] = useState(DEFAULT_FORM)
  const [mapsSearch, setMapsSearch] = useState('')
  const [mapsResults, setMapsResults] = useState([])
  const [isSearchingMaps, setIsSearchingMaps] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryIcon, setNewCategoryIcon] = useState('📍')
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState([])
  const [prefillDetails, setPrefillDetails] = useState<Record<string, any> | null>(null)
  const [prefillDetailsLoading, setPrefillDetailsLoading] = useState(false)
  const fileRef = useRef(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [acSuggestions, setAcSuggestions] = useState<{ placeId: string; mainText: string; secondaryText: string }[]>([])
  const [acHighlight, setAcHighlight] = useState(-1)
  const acDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const acAbortRef = useRef<AbortController | null>(null)
  const toast = useToast()
  const { t, language } = useTranslation()
  const { hasMapsKey, user } = useAuthStore()
  const can = useCanDo()
  const tripObj = useTripStore((s) => s.trip)
  const canUploadFiles = can('file_upload', tripObj)
  const collectionsEnabled = useAddonStore((s) => s.isEnabled('collections'))
  const canCreateCategory = user?.role === 'admin'

  useEffect(() => {
    if (place) {
      // Times are stored per day-assignment, not on the pool place. When an
      // assignment is in context (itinerary edit, or a single-assignment pool
      // edit), only duration is edited. Start/end timestamps are calculated from
      // day wake time, activity durations, and route travel.
      const assignment = assignmentId ? dayAssignments.find(a => a.id === assignmentId) : null
      const durationMinutes = assignment?.duration_minutes ?? assignment?.place?.duration_minutes ?? place.duration_minutes
      setForm({
        name: place.name || '',
        description: place.description || '',
        address: place.address || '',
        lat: place.lat != null ? String(place.lat) : '',
        lng: place.lng != null ? String(place.lng) : '',
        category_id: place.category_id != null ? String(place.category_id) : '',
        duration_minutes: durationMinutes != null ? String(durationMinutes) : '60',
        notes: place.notes || '',
        transport_mode: place.transport_mode || 'walking',
        website: place.website || '',
      })
    } else if (prefillCoords) {
      setForm({
        ...DEFAULT_FORM,
        lat: String(prefillCoords.lat),
        lng: String(prefillCoords.lng),
        name: prefillCoords.name || '',
        address: prefillCoords.address || '',
        website: prefillCoords.website || '',
        phone: prefillCoords.phone || '',
        osm_id: prefillCoords.osm_id,
      })
    } else {
      setForm(DEFAULT_FORM)
    }
    setPendingFiles([])
    setDuplicateWarning(null)
    // dayAssignments is a fresh array each render; read it at open-time only and
    // re-run on identity changes (place/assignmentId/open), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, prefillCoords, isOpen, assignmentId])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        const modal = searchInputRef.current?.closest('[role="dialog"]') ?? document.body
        if (!modal.contains(document.activeElement) || document.activeElement === document.body) {
          searchInputRef.current?.focus()
        }
      }, 50)
    }
  }, [isOpen])

  useEffect(() => {
    const placeId = prefillCoords?.osm_id
    if (!isOpen || place || !placeId) {
      setPrefillDetails(null)
      setPrefillDetailsLoading(false)
      return
    }

    let cancelled = false
    setPrefillDetails(null)
    setPrefillDetailsLoading(true)

    mapsApi.details(placeId, language, { expand: true })
      .then(result => {
        if (cancelled) return
        const details = result.place as Record<string, any> | null
        setPrefillDetails(details)
        if (!details) return
        setForm(prev => ({
          ...prev,
          name: cleanMapsText(details.name_translated) || cleanMapsText(details.name) || prev.name,
          description: cleanMapsText(details.summary) || prev.description,
          address: cleanMapsText(details.written_address) || cleanMapsText(details.address_translated) || cleanMapsText(details.address) || prev.address,
          lat: typeof details.lat === 'number' ? String(details.lat) : prev.lat,
          lng: typeof details.lng === 'number' ? String(details.lng) : prev.lng,
          google_place_id: cleanMapsText(details.google_place_id) || prev.google_place_id,
          google_ftid: cleanMapsText(details.google_ftid) || prev.google_ftid,
          website: cleanMapsText(details.website) || prev.website,
          phone: cleanMapsText(details.phone) || prev.phone,
        }))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPrefillDetailsLoading(false)
      })

    return () => { cancelled = true }
  }, [isOpen, place, prefillCoords?.osm_id, language])

  // Derive location bias bounding box from the trip's existing places
  const places = useTripStore((s) => s.places)
  const locationBias = useMemo(() => {
    const withCoords = (places || []).filter((p) => p.lat != null && p.lng != null)
    if (withCoords.length === 0) return undefined

    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
    for (const p of withCoords) {
      const lat = Number(p.lat), lng = Number(p.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }
    if (!Number.isFinite(minLat)) return undefined

    // Skip bias if the bounding box is too large (~500 km diagonal)
    const dlat = maxLat - minLat
    const dlng = maxLng - minLng
    const avgLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180)
    const diagKm = Math.sqrt((dlat * 111) ** 2 + (dlng * 111 * Math.cos(avgLatRad)) ** 2)
    if (diagKm > 500) return undefined

    return { low: { lat: minLat, lng: minLng }, high: { lat: maxLat, lng: maxLng } }
  }, [places])

  // Autocomplete fetch — aborts any in-flight request before starting a new one
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2 || isGoogleMapsUrl(query)) {
      setAcSuggestions([])
      setAcHighlight(-1)
      return
    }
    acAbortRef.current?.abort()
    const controller = new AbortController()
    acAbortRef.current = controller
    try {
      const result = await mapsApi.autocomplete(query, language, locationBias, controller.signal)
      setAcSuggestions(result.suggestions || [])
      setAcHighlight(-1)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      if (err instanceof Error && err.name === 'CanceledError') return // axios abort
      console.error('Autocomplete failed:', err)
      setAcSuggestions([])
    }
  }, [language, locationBias])

  // Debounce effect — only watches mapsSearch
  useEffect(() => {
    if (acDebounceRef.current) clearTimeout(acDebounceRef.current)

    const trimmed = mapsSearch.trim()
    if (trimmed.length < 2 || isGoogleMapsUrl(trimmed)) {
      setAcSuggestions([])
      setAcHighlight(-1)
      return
    }

    acDebounceRef.current = setTimeout(() => fetchSuggestions(trimmed), 300)

    return () => {
      if (acDebounceRef.current) clearTimeout(acDebounceRef.current)
    }
  }, [mapsSearch, fetchSuggestions])

  const handleChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleMapsSearch = async () => {
    if (!mapsSearch.trim()) return
    setIsSearchingMaps(true)
    try {
      // Detect Google Maps URLs and resolve them directly
      const trimmed = mapsSearch.trim()
      if (isGoogleMapsUrl(trimmed)) {
        const resolved = await mapsApi.resolveUrl(trimmed)
        if (resolved.lat && resolved.lng) {
          setForm(prev => ({
            ...prev,
            name: resolved.name || prev.name,
            address: resolved.address || prev.address,
            lat: String(resolved.lat),
            lng: String(resolved.lng),
            google_ftid: resolved.google_ftid || prev.google_ftid,
          }))
          setMapsResults([])
          setMapsSearch('')
          toast.success(t('places.urlResolved'))
          return
        }
      }
      const result = await mapsApi.search(mapsSearch, language)
      setMapsResults(result.places || [])
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, t('places.mapsSearchError')))
    } finally {
      setIsSearchingMaps(false)
    }
  }

  const handleSelectMapsResult = (result) => {
    setForm(prev => ({
      ...prev,
      name: result.name || prev.name,
      address: result.address || prev.address,
      lat: result.lat || prev.lat,
      lng: result.lng || prev.lng,
      google_place_id: result.google_place_id || prev.google_place_id,
      google_ftid: result.google_ftid || prev.google_ftid,
      osm_id: result.osm_id || prev.osm_id,
      website: result.website || prev.website,
      phone: result.phone || prev.phone,
    }))
    setMapsResults([])
    setMapsSearch('')
  }

  const handleSelectSuggestion = async (suggestion: { placeId: string; mainText: string; secondaryText: string }) => {
    setAcSuggestions([])
    setAcHighlight(-1)
    const previousSearch = mapsSearch
    setMapsSearch('')
    setForm(prev => ({ ...prev, name: suggestion.mainText }))
    setIsSearchingMaps(true)
    try {
      // The details lookup is a fragile second hop — it can fail when the
      // details kill-switch is off, when the OSM Overpass mirror is overloaded,
      // or on any upstream error. Treat a missing/coordinate-less place as a
      // miss and fall back to the reliable text-search path the search button
      // uses (its results already carry coordinates), so dropdown items stay
      // clickable instead of dead-ending on "Place search failed". (#1192)
      let place: Record<string, unknown> | null = null
      try {
        const result = await mapsApi.details(suggestion.placeId, language)
        if (result.place && result.place.lat != null && result.place.lng != null) {
          place = result.place
        }
      } catch (err) {
        console.error('Failed to fetch place details:', err)
      }
      if (!place) {
        const query = [suggestion.mainText, suggestion.secondaryText].filter(Boolean).join(', ')
        const search = await mapsApi.search(query, language)
        place = search.places?.[0] ?? null
      }
      if (place) {
        handleSelectMapsResult(place)
      } else {
        setMapsSearch(previousSearch)
        toast.error(t('places.mapsSearchError'))
      }
    } catch (err) {
      console.error('Place suggestion lookup failed:', err)
      setMapsSearch(previousSearch)
      toast.error(getApiErrorMessage(err, t('places.mapsSearchError')))
    } finally {
      setIsSearchingMaps(false)
    }
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (acSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAcHighlight(prev => (prev + 1) % acSuggestions.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAcHighlight(prev => (prev <= 0 ? acSuggestions.length - 1 : prev - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (acHighlight >= 0) {
          handleSelectSuggestion(acSuggestions[acHighlight])
        } else {
          setAcSuggestions([])
          handleMapsSearch()
        }
      } else if (e.key === 'Escape') {
        setAcSuggestions([])
        setAcHighlight(-1)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleMapsSearch()
    }
  }

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return
    try {
      const cat = await onCategoryCreated?.({ name: newCategoryName, color: '#6366f1', icon: newCategoryIcon.trim() || '📍' })
      if (cat) setForm(prev => ({ ...prev, category_id: String(cat.id) }))
      setNewCategoryName('')
      setNewCategoryIcon('📍')
      setShowNewCategory(false)
    } catch (err: unknown) {
      toast.error(t('places.categoryCreateError'))
    }
  }

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    setPendingFiles(prev => [...prev, ...files])
    e.target.value = ''
  }

  const handleRemoveFile = (idx: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx))
  }

  // Paste support for files/images
  const handlePaste = (e: React.ClipboardEvent) => {
    if (!canUploadFiles) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/') || item.type === 'application/pdf') {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) setPendingFiles(prev => [...prev, file])
        return
      }
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error(t('places.nameRequired'))
      return
    }
    // #1152: only for new places, and only on the first attempt — a second click
    // (with the warning already showing) is the explicit "add anyway" confirmation.
    if (!place && !duplicateWarning) {
      const dup = findDuplicatePlace(form, places)
      if (dup) {
        const dupName = dup.name || form.name
        setDuplicateWarning(dupName)
        toast.warning(t('places.duplicateExists', { name: dupName }))
        return
      }
    }
    setIsSaving(true)
    try {
      await onSave({
        ...form,
        lat: form.lat ? parseFloat(form.lat) : null,
        lng: form.lng ? parseFloat(form.lng) : null,
        category_id: form.category_id || null,
        _pendingFiles: pendingFiles.length > 0 ? pendingFiles : undefined,
      })
      onClose()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('places.saveError'))
    } finally {
      setIsSaving(false)
    }
  }

  return {
    isOpen,
    onClose,
    onSave,
    place,
    prefillCoords,
    tripId,
    categories,
    onCategoryCreated,
    assignmentId,
    dayAssignments,
    isMobile,
    collectionsEnabled,
    form,
    setForm,
    mapsSearch,
    setMapsSearch,
    mapsResults,
    setMapsResults,
    isSearchingMaps,
    setIsSearchingMaps,
    newCategoryName,
    setNewCategoryName,
    newCategoryIcon,
    setNewCategoryIcon,
    showNewCategory,
    setShowNewCategory,
    isSaving,
    setIsSaving,
    pendingFiles,
    setPendingFiles,
    prefillDetails,
    prefillDetailsLoading,
    fileRef,
    acSuggestions,
    setAcSuggestions,
    acHighlight,
    setAcHighlight,
    acDebounceRef,
    acAbortRef,
    toast,
    t,
    language,
    hasMapsKey,
    can,
    tripObj,
    canUploadFiles,
    canCreateCategory,
    places,
    locationBias,
    searchInputRef,
    fetchSuggestions,
    handleChange,
    handleMapsSearch,
    handleSelectMapsResult,
    handleSelectSuggestion,
    handleSearchKeyDown,
    handleCreateCategory,
    handleFileAdd,
    handleRemoveFile,
    handlePaste,
    handleSubmit,
    duplicateWarning,
  }
}

export default function PlaceFormModal(props: PlaceFormModalProps) {
  const S = usePlaceFormModal(props)
  const {
    isOpen,
    onClose,
    onSave,
    place,
    prefillCoords,
    tripId,
    categories,
    onCategoryCreated,
    assignmentId,
    dayAssignments,
    isMobile,
    collectionsEnabled,
    form,
    setForm,
    mapsSearch,
    setMapsSearch,
    mapsResults,
    setMapsResults,
    isSearchingMaps,
    setIsSearchingMaps,
    newCategoryName,
    setNewCategoryName,
    newCategoryIcon,
    setNewCategoryIcon,
    showNewCategory,
    setShowNewCategory,
    isSaving,
    setIsSaving,
    pendingFiles,
    setPendingFiles,
    prefillDetails,
    prefillDetailsLoading,
    fileRef,
    acSuggestions,
    setAcSuggestions,
    acHighlight,
    setAcHighlight,
    acDebounceRef,
    acAbortRef,
    toast,
    t,
    language,
    hasMapsKey,
    can,
    tripObj,
    canUploadFiles,
    canCreateCategory,
    places,
    locationBias,
    searchInputRef,
    fetchSuggestions,
    handleChange,
    handleMapsSearch,
    handleSelectMapsResult,
    handleSelectSuggestion,
    handleSearchKeyDown,
    handleCreateCategory,
    handleFileAdd,
    handleRemoveFile,
    handlePaste,
    handleSubmit,
    duplicateWarning,
  } = S
  // Desktop + Collections addon → two columns (form + saved-place picker). Mobile
  // always keeps the original single-column form untouched.
  const twoColumn = !isMobile && collectionsEnabled
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={place ? t('places.editPlace') : t('places.addPlace')}
      size={twoColumn ? '3xl' : 'lg'}
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="px-6 py-2 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-700 disabled:opacity-60 font-medium"
          >
            {isSaving ? t('common.saving') : place ? t('common.update') : duplicateWarning ? t('places.addAnyway') : t('common.add')}
          </button>
        </div>
      }
    >
      <div className={twoColumn ? 'flex gap-5 items-stretch' : ''}>
      <form onSubmit={handleSubmit} className={twoColumn ? 'flex-1 min-w-0 space-y-4' : 'space-y-4'} onPaste={handlePaste}>
        {/* Place Search */}
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
          {!hasMapsKey && (
            <p className="mb-2 text-xs text-content-faint">
              {t('places.osmActive')}
            </p>
          )}
          <div className="relative">
            <div className="flex gap-2">
              <input
                ref={searchInputRef}
                type="text"
                value={mapsSearch}
                onChange={e => setMapsSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onBlur={() => setTimeout(() => setAcSuggestions([]), 150)}
                onFocus={() => {
                  if (mapsSearch.trim().length >= 2 && acSuggestions.length === 0 && mapsResults.length === 0) {
                    fetchSuggestions(mapsSearch.trim())
                  }
                }}
                placeholder={t('places.mapsSearchPlaceholder')}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
              />
              <button
                type="button"
                onClick={() => { setAcSuggestions([]); handleMapsSearch() }}
                disabled={isSearchingMaps}
                className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-slate-700 disabled:opacity-60"
              >
                {isSearchingMaps ? '...' : <Search className="w-4 h-4" />}
              </button>
            </div>

            {/* Autocomplete dropdown */}
            {acSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 z-20 mt-1 bg-white rounded-lg border border-slate-200 shadow-lg overflow-hidden">
                {acSuggestions.map((s, idx) => (
                  <button
                    key={s.placeId}
                    type="button"
                    onMouseDown={() => handleSelectSuggestion(s)}
                    onMouseEnter={() => setAcHighlight(idx)}
                    className={`w-full text-left px-3 py-2 border-b border-slate-100 last:border-0 ${
                      idx === acHighlight ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-medium text-sm">{s.mainText}</div>
                    {s.secondaryText && (
                      <div className="text-xs text-slate-500 truncate">{s.secondaryText}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search results (populated after full search) */}
          {mapsResults.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden max-h-40 overflow-y-auto mt-2">
              {mapsResults.map((result, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectMapsResult(result)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                >
                  <div className="font-medium text-sm">{result.name}</div>
                  <div className="text-xs text-slate-500 truncate">{result.address}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <PrefillDetailsPanel
          details={prefillDetails}
          loading={prefillDetailsLoading}
          lat={form.lat}
          lng={form.lng}
          fallbackName={form.name}
          fallbackOsmId={form.osm_id}
          t={t}
          language={language}
        />

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.formName')} *</label>
          <div className="relative">
            <input
              type="text"
              value={form.name}
              onChange={e => handleChange('name', e.target.value)}
              required
              placeholder={t('places.formNamePlaceholder')}
              className="form-input"
            />
            {isSearchingMaps && (
              <div className="absolute right-2.5 top-0 bottom-0 flex items-center" role="status" aria-label={t('places.loadingDetails')}>
                <Loader2 className="w-4 h-4 animate-spin text-slate-400" aria-hidden="true" />
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.formDescription')}</label>
          <textarea
            value={form.description}
            onChange={e => handleChange('description', e.target.value)}
            rows={2}
            placeholder={t('places.formDescriptionPlaceholder')}
            className="form-input" style={{ resize: 'vertical' }}
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.formNotes')}</label>
          <textarea
            value={form.notes}
            onChange={e => handleChange('notes', e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t('places.formNotesPlaceholder')}
            className="form-input" style={{ resize: 'vertical' }}
          />
        </div>

        {/* Address + Coordinates */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.formAddress')}</label>
          <input
            type="text"
            value={form.address}
            onChange={e => handleChange('address', e.target.value)}
            placeholder={t('places.formAddressPlaceholder')}
            className="form-input"
          />
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input
              type="number"
              step="any"
              value={form.lat}
              onChange={e => handleChange('lat', e.target.value)}
              onPaste={e => {
                const text = e.clipboardData.getData('text').trim()
                const match = text.match(/^(-?\d+\.?\d*)\s*[,;\s]\s*(-?\d+\.?\d*)$/)
                if (match) {
                  e.preventDefault()
                  handleChange('lat', match[1])
                  handleChange('lng', match[2])
                }
              }}
              placeholder={t('places.formLat')}
              className="form-input"
            />
            <input
              type="number"
              step="any"
              value={form.lng}
              onChange={e => handleChange('lng', e.target.value)}
              placeholder={t('places.formLng')}
              className="form-input"
            />
          </div>
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.formCategory')}</label>
          {!showNewCategory ? (
            <div className="flex gap-2">
              <CustomSelect
                value={form.category_id}
                onChange={value => handleChange('category_id', String(value))}
                placeholder={t('places.noCategory')}
                options={[
                  { value: '', label: t('places.noCategory') },
                  ...(categories || []).map(c => ({
                    // form.category_id is a string; CustomSelect matches options by
                    // strict equality, so the option value must be a string too —
                    // otherwise the chosen category never renders in the trigger.
                    value: String(c.id),
                    label: c.name,
                  })),
                ]}
                style={{ flex: 1 }}
                size="sm"
              />
              {canCreateCategory && (
                <button
                  type="button"
                  onClick={() => setShowNewCategory(true)}
                  aria-label={t('categories.new')}
                  className="border border-slate-200 text-slate-600 rounded-lg px-2 hover:bg-slate-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategoryIcon}
                onChange={e => setNewCategoryIcon(e.target.value)}
                aria-label={t('categories.icon')}
                maxLength={8}
                className="form-input text-center"
                style={{ width: 52, flexShrink: 0 }}
              />
              <input
                type="text"
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                placeholder={t('places.categoryNamePlaceholder')}
                className="form-input" style={{ flex: 1 }}
              />
              <button type="button" onClick={handleCreateCategory} className="bg-slate-900 text-white px-3 rounded-lg hover:bg-slate-700 text-sm">
                OK
              </button>
              <button type="button" onClick={() => { setShowNewCategory(false); setNewCategoryIcon('📍') }} className="text-gray-500 px-2 text-sm">
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>

        {/* Duration is per day-assignment. Start/end timestamps are calculated. */}
        {place && assignmentId && (
          <DurationSection
            form={form}
            handleChange={handleChange}
            t={t}
          />
        )}

        {/* Website */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.formWebsite')}</label>
          <input
            type="url"
            value={form.website}
            onChange={e => handleChange('website', e.target.value)}
            placeholder="https://..."
            className="form-input"
          />
        </div>

        {/* File Attachments */}
        {canUploadFiles && (
          <div className="border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">{t('files.title')}</label>
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors">
                <Paperclip size={12} /> {t('files.attach')}
              </button>
            </div>
            <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileAdd} />
            {pendingFiles.length > 0 && (
              <div className="space-y-1">
                {pendingFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50 text-xs">
                    <Paperclip size={10} className="text-slate-400 shrink-0" />
                    <span className="truncate flex-1 text-slate-600">{file.name}</span>
                    <button type="button" onClick={() => handleRemoveFile(idx)} className="text-slate-400 hover:text-red-500 shrink-0">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {pendingFiles.length === 0 && (
              <p className="text-xs text-slate-400">{t('files.pasteHint')}</p>
            )}
          </div>
        )}

      </form>
      {twoColumn && (
        <CollectionPicker bias={locationBias} onSelect={handleSelectMapsResult} t={t} />
      )}
      </div>
    </Modal>
  )
}

interface DurationSectionProps {
  form: PlaceFormData
  handleChange: (field: string, value: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

interface PrefillDetailsPanelProps {
  details: Record<string, any> | null
  loading: boolean
  lat: string
  lng: string
  fallbackName: string
  fallbackOsmId?: string
  t: (key: string, params?: Record<string, string | number>) => string
  language: string
}

function shortWeekday(day: number, locale: string): string {
  const base = new Date(Date.UTC(2026, 5, 28 + day, 12))
  return base.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })
}

function PrefillDetailsPanel({ details, loading, lat, lng, fallbackName, fallbackOsmId, t, language }: PrefillDetailsPanelProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const photoId = cleanMapsText(details?.google_place_id) || cleanMapsText(details?.google_ftid) || cleanMapsText(fallbackOsmId)
  const directPhotoUrls = uniqueDetailPhotoUrls(Array.isArray(details?.photos) ? details.photos : [])
  const photoLat = typeof details?.lat === 'number' ? details.lat : lat ? Number(lat) : undefined
  const photoLng = typeof details?.lng === 'number' ? details.lng : lng ? Number(lng) : undefined
  const photoName = cleanMapsText(details?.name) || fallbackName

  useEffect(() => {
    let cancelled = false
    setPhotoUrl(null)
    if (!details || directPhotoUrls.length > 0 || !photoId) return () => { cancelled = true }
    mapsApi.placePhoto(photoId, photoLat, photoLng, photoName)
      .then(result => {
        if (!cancelled && result?.photoUrl) setPhotoUrl(result.photoUrl)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [details, directPhotoUrls.length, photoId, photoLat, photoLng, photoName])

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500 flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> {t('places.loadingDetails')}
      </div>
    )
  }
  if (!details) return null

  const names = uniqueMapsTexts(details.name_translated || details.name, details.name_original)
  const address = cleanMapsText(details.written_address) || cleanMapsText(details.address_translated) || cleanMapsText(details.address)
  const placeType = mapsTypeLabel(details.type || details.types?.[0] || details.primary_type)
  const rating = typeof details.rating === 'number' ? details.rating : null
  const ratingCount = typeof details.rating_count === 'number' ? details.rating_count : null
  const accessibility = Array.isArray(details.accessibility) ? details.accessibility : []
  const reviews = Array.isArray(details.reviews) ? details.reviews.filter(r => r?.text || r?.author).slice(0, 2) : []
  const popularTimes = Array.isArray(details.popular_times) ? details.popular_times : []
  const popularStatus = cleanMapsText(details.popular_status)
  const photoCount = Array.isArray(details.photos) ? details.photos.length : 0
  const photoUrls = uniqueDetailPhotoUrls(directPhotoUrls, photoUrl)
  const displayedPhotoCount = Math.max(photoCount, photoUrls.length)
  const popularByDay = new Map<number, Array<{ hour: number; occupancy_percent: number }>>()
  for (const item of popularTimes) {
    if (typeof item?.day !== 'number' || typeof item?.hour !== 'number' || typeof item?.occupancy_percent !== 'number') continue
    if (!popularByDay.has(item.day)) popularByDay.set(item.day, [])
    popularByDay.get(item.day)!.push(item)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {photoUrls.length > 0 && (
        <div className="bg-slate-100 p-2">
          <div className="flex gap-2 overflow-x-auto overscroll-x-contain [scroll-snap-type:x_proximity]">
            {photoUrls.map((url, index) => (
              <div key={url} className="relative h-32 flex-[0_0_min(76vw,190px)] snap-start overflow-hidden rounded-lg bg-slate-100">
                <img src={url} alt={photoName} loading={index === 0 ? 'eager' : 'lazy'} className="h-full w-full object-cover" />
                {index === 0 && displayedPhotoCount > 1 && (
                  <div className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-semibold text-white">
                    <ImageIcon size={12} /> {t('inspector.photosCount', { count: displayedPhotoCount })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="p-3 space-y-2">
        {names.length > 0 && (
          <div className="space-y-0.5">
            {names.map((name, idx) => (
              <div key={name} className={idx === 0 ? 'text-sm font-semibold text-slate-900' : 'text-xs text-slate-500'}>{name}</div>
            ))}
          </div>
        )}
        {address && (
          <div className="flex items-start gap-1.5 text-xs text-slate-500">
            <MapPin size={12} className="mt-0.5 shrink-0" /> <span>{address}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {placeType && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
              <Info size={11} /> {placeType}
            </span>
          )}
          {rating && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
              <Star size={11} fill="#facc15" color="#facc15" /> {rating}{ratingCount ? ` (${ratingCount})` : ''}
            </span>
          )}
          {details.accessible !== null && details.accessible !== undefined && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${details.accessible ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              <Accessibility size={11} /> {details.accessible ? t('inspector.accessible') : t('inspector.accessibilityLimited')}
            </span>
          )}
        </div>
        {cleanMapsText(details.summary) && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            {cleanMapsText(details.summary)}
          </div>
        )}
        {accessibility.length > 0 && (
          <div className="space-y-1">
            {accessibility.slice(0, 3).map((feature, idx) => (
              <div key={feature.key || idx} className="text-xs text-slate-500">{feature.text || feature.label}</div>
            ))}
          </div>
        )}
        {reviews.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><MessageSquare size={12} /> {t('inspector.reviews')}</div>
            {reviews.map((review, idx) => (
              <div key={`${review.author || 'review'}-${idx}`} className="text-xs text-slate-500">
                {review.author && <span className="font-medium text-slate-700">{review.author}: </span>}
                <span>{review.text}</span>
              </div>
            ))}
          </div>
        )}
        {(popularByDay.size > 0 || popularStatus) && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><BarChart3 size={12} /> {t('inspector.popularTimes')}</div>
            {popularStatus && (
              <div className="text-xs leading-5 text-slate-500">{popularStatus}</div>
            )}
            <div className="space-y-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map(day => {
                const values = (popularByDay.get(day) || []).slice().sort((a, b) => a.hour - b.hour)
                if (values.length === 0) return null
                const peak = Math.max(...values.map(v => v.occupancy_percent))
                const byHour = new Map(values.map(v => [v.hour, v.occupancy_percent]))
                return (
                  <div key={day} className="grid grid-cols-[2.2rem_minmax(0,1fr)_2rem] items-center gap-1.5">
                    <div className="truncate text-[10px] font-medium text-slate-400">{shortWeekday(day, language)}</div>
                    <div className="grid h-7 grid-cols-[repeat(24,minmax(2px,1fr))] items-end gap-0.5">
                      {Array.from({ length: 24 }, (_, hour) => {
                        const percent = byHour.get(hour) || 0
                        return (
                          <div
                            key={`${day}-${hour}`}
                            title={`${hour}:00 · ${percent}%`}
                            className={percent > 0 && percent === peak ? 'rounded-sm bg-slate-700' : percent > 0 ? 'rounded-sm bg-slate-300' : 'rounded-sm bg-slate-100'}
                            style={{ height: `${percent > 0 ? Math.max(4, percent * 0.28) : 2}px` }}
                          />
                        )
                      })}
                    </div>
                    <div className="text-right text-[10px] text-slate-400">{peak}%</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DurationSection({ form, handleChange, t }: DurationSectionProps) {
  return (
    <div>
      <div>
        <label htmlFor="place-duration-input" className="block text-sm font-medium text-gray-700 mb-1">{t('places.durationMinutes')}</label>
        <input
          id="place-duration-input"
          type="text"
          inputMode="text"
          value={form.duration_minutes}
          onChange={e => handleChange('duration_minutes', e.target.value)}
          placeholder={t('places.durationPlaceholder')}
          className="form-input"
          style={{ width: '100%' }}
        />
      </div>
    </div>
  )
}
