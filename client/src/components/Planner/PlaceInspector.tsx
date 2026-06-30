import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { avatarSrc } from '../../utils/avatarSrc'
import { openFile } from '../../utils/fileDownload'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { X, Clock, MapPin, ExternalLink, Phone, Banknote, Edit2, Trash2, Plus, Minus, ChevronDown, ChevronUp, FileText, Upload, File, FileImage, Star, Navigation, Map as MapIcon, Users, Mountain, TrendingUp, Bookmark, BookmarkCheck, Copy, Info, Accessibility, MessageSquare, Image as ImageIcon, BarChart3 } from 'lucide-react'
import PlaceAvatar from '../shared/PlaceAvatar'
import GuestBadge from '../shared/GuestBadge'
import StatusBadge from '../Collections/StatusBadge'
import PhotoLightbox from '../Journey/PhotoLightbox'
import { mapsApi, pluginsApi } from '../../api/client'
import { collectionsApi } from '../../api/collections'
import { useSettingsStore } from '../../store/settingsStore'
import { useAddonStore } from '../../store/addonStore'
import { useSaveToCollectionStore } from '../../store/saveToCollectionStore'
import { getCategoryIcon, isEmojiCategoryIcon } from '../shared/categoryIcons'
import { useToast } from '../shared/Toast'
import { useTranslation, translateApiError } from '../../i18n'
import { usePluginStore } from '../../store/pluginStore'
import PluginFrame from '../Plugins/PluginFrame'
import type { Place, Category, Day, Assignment, Reservation, TripFile, AssignmentsMap, DistanceUnit } from '../../types'
import type { CollectionStatus } from '@trek/shared'
import { splitReservationDateTime, formatTime, formatMoney } from '../../utils/formatters'
import { useTripStore } from '../../store/tripStore'
import { formatDistance, formatElevation } from '../../utils/units'
import { getGoogleMapsUrlForPlace } from './placeGoogleMaps'
import { getOpenStreetMapUrlForPlace } from './placeOpenStreetMap'
import { formatDurationInput, parseDurationMinutes } from '../../utils/durationInput'
import { buildActivitySchedule } from '../../utils/daySchedule'
import { parseTimeToMinutes } from '../../utils/dayMerge'

const detailsCache = new Map()
const INFO_BLOCK_CLASS = 'mb-2 break-inside-avoid rounded-[10px] bg-surface-hover px-3 py-2.5'
const INFO_BLOCK_FLUSH_CLASS = 'mb-2 break-inside-avoid overflow-hidden rounded-[10px] bg-surface-hover'
const INFO_BLOCK_HEADER_CLASS = 'mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-content-secondary'
const POPULAR_TIME_HIGHLIGHT_COLOR = 'var(--journal-accent)'

type TFunction = (key: string, params?: Record<string, string | number>) => string

function getSessionCache(key) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch { return undefined }
}

function setSessionCache(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch {}
}

function usePlaceDetails(googlePlaceId, googleFtid, osmId, language) {
  const [details, setDetails] = useState(null)
  const detailId = googlePlaceId || googleFtid || osmId
  const cacheKey = `gdetails_v11_expanded_${detailId}_${language}`
  useEffect(() => {
    if (!detailId) { setDetails(null); return }
    if (detailsCache.has(cacheKey)) { setDetails(detailsCache.get(cacheKey)); return }
    const cached = getSessionCache(cacheKey)
    if (cached) { detailsCache.set(cacheKey, cached); setDetails(cached); return }
    let cancelled = false
    setDetails(null)
    mapsApi.details(detailId, language, { expand: true }).then(data => {
      if (cancelled) return
      detailsCache.set(cacheKey, data.place)
      setSessionCache(cacheKey, data.place)
      setDetails(data.place)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [detailId, language, cacheKey])
  return details
}

function getWeekdayIndex(dateStr) {
  // weekdayDescriptions[0] = Monday … [6] = Sunday
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date()
  const jsDay = d.getDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

function getPopularWeekdayIndex(dateStr) {
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date()
  return d.getDay()
}

interface PopularTimesSchedule {
  day: number | null
  startHour: number | null
  endHour: number | null
  label: string | null
}

function isScheduledPopularHour(day: number, hour: number, schedule?: PopularTimesSchedule | null): boolean {
  if (!schedule || schedule.day !== day || schedule.startHour == null || schedule.endHour == null) return false
  if (schedule.endHour <= 24) return hour >= schedule.startHour && hour < schedule.endHour
  return hour >= schedule.startHour || hour < (schedule.endHour % 24)
}

function popularBarBackground(percent: number, peak: number, scheduled: boolean): string {
  if (scheduled) return POPULAR_TIME_HIGHLIGHT_COLOR
  if (percent <= 0) return 'color-mix(in srgb, var(--text-faint) 34%, transparent)'
  if (percent === peak) return 'color-mix(in srgb, var(--accent) 76%, var(--text-primary))'
  return 'color-mix(in srgb, var(--accent) 44%, var(--text-muted))'
}

function convertHoursLine(line, timeFormat) {
  if (!line) return ''
  const hasAmPm = /\d{1,2}:\d{2}\s*(AM|PM)/i.test(line)

  if (timeFormat === '12h' && !hasAmPm) {
    // 24h → 12h: "10:00" → "10:00 AM", "21:00" → "9:00 PM", "Uhr" entfernen
    return line.replace(/\s*Uhr/g, '').replace(/(\d{1,2}):(\d{2})/g, (match, h, m) => {
      const hour = parseInt(h)
      if (isNaN(hour)) return match
      const period = hour >= 12 ? 'PM' : 'AM'
      const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
      return `${h12}:${m} ${period}`
    })
  }
  if (timeFormat !== '12h' && hasAmPm) {
    // 12h → 24h: "10:00 AM" → "10:00", "9:00 PM" → "21:00"
    return line.replace(/(\d{1,2}):(\d{2})\s*(AM|PM)/gi, (_, h, m, p) => {
      let hour = parseInt(h)
      if (p.toUpperCase() === 'PM' && hour !== 12) hour += 12
      if (p.toUpperCase() === 'AM' && hour === 12) hour = 0
      return `${String(hour).padStart(2, '0')}:${m}`
    })
  }
  return line
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function humanizeType(value) {
  const text = cleanText(value)
  if (!text) return null
  const cleaned = text.replace(/^SearchResult\.TYPE_/i, '').replace(/^gcid:/i, '').replace(/_/g, ' ').toLowerCase()
  return cleaned.replace(/\b\w/g, c => c.toUpperCase())
}

function photoUrlFromRecord(photo: unknown): string | null {
  if (!photo || typeof photo !== 'object') return null
  const record = photo as Record<string, unknown>
  for (const key of ['url', 'photoUrl', 'src']) {
    const value = cleanText(record[key])
    if (value) return value
  }
  return null
}

function uniquePhotoUrls(...sources: Array<string | null | undefined | any[]>): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    const values = Array.isArray(source) ? source.map(item => typeof item === 'string' ? cleanText(item) : photoUrlFromRecord(item)) : [cleanText(source)]
    for (const value of values) {
      if (!value || seen.has(value)) continue
      seen.add(value)
      urls.push(value)
    }
  }
  return urls
}

function uniqueNameParts(...values) {
  const out = []
  for (const value of values) {
    const text = cleanText(value)
    if (!text) continue
    if (out.some(existing => existing.localeCompare(text, undefined, { sensitivity: 'accent' }) === 0)) continue
    out.push(text)
  }
  return out
}

function weekdayName(day, locale) {
  const base = new Date(Date.UTC(2026, 5, 28 + day, 12))
  return base.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })
}

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface TripMember {
  id: number
  username: string
  avatar?: string | null
  avatar_url?: string | null
  is_guest?: boolean
}

interface PlaceInspectorProps {
  place: Place | null
  categories: Category[]
  /** 'trip' (default) keeps every existing trip-planner behaviour byte-identical;
   *  'collection' hides the day/reservation/file sub-panels and swaps the footer
   *  for the saved-place actions (copy to trip, status, remove from list). */
  mode?: 'trip' | 'collection'
  // ── Trip-only props (optional so the collection detail panel can omit them) ──
  days?: Day[]
  selectedDayId?: number | null
  selectedAssignmentId?: number | null
  assignments?: AssignmentsMap
  reservations?: Reservation[]
  onClose: () => void
  onEdit?: () => void
  onDelete?: () => void
  onAssignToDay?: (placeId: number, dayId?: number) => void
  onRemoveAssignment?: (dayId: number, assignmentId: number) => void
  files?: TripFile[]
  onFileUpload?: (fd: FormData) => Promise<unknown>
  tripMembers?: TripMember[]
  onSetParticipants?: (assignmentId: number, dayId: number, participantIds: number[]) => void
  onUpdatePlace?: (placeId: number, data: Partial<Place>) => void
  onUpdateAssignmentDuration?: (assignmentId: number, dayId: number, durationMinutes: number) => Promise<void> | void
  scheduleMarginMinutes?: number
  leftWidth?: number
  rightWidth?: number
  // ── Collection-mode props ──
  collectionStatus?: CollectionStatus
  onCopyToTrip?: () => void
  onSetStatus?: (status: CollectionStatus) => void
  onRemoveFromList?: () => void
}

export default function PlaceInspector({
  place, categories, mode = 'trip', days = [], selectedDayId = null, selectedAssignmentId = null,
  assignments = {}, reservations = [],
  onClose, onEdit, onDelete, onAssignToDay, onRemoveAssignment,
  files = [], onFileUpload, tripMembers = [], onSetParticipants, onUpdatePlace,
  onUpdateAssignmentDuration,
  scheduleMarginMinutes = 0,
  leftWidth = 0, rightWidth = 0,
  collectionStatus, onCopyToTrip, onSetStatus, onRemoveFromList,
}: PlaceInspectorProps) {
  // Plugins that declared a place-detail slot mount at the bottom of this panel,
  // scoped to the open place (trip mode only). Inline-filter like the other sites.
  const placeDetailPlugins = usePluginStore((s) => s.plugins).filter((p) => p.type === 'widget' && p.slot === 'place-detail')
  // Extra native rows contributed by placeDetailProvider plugins (#1429). Fail-safe:
  // any provider error/timeout is dropped server-side, so this only ever adds rows.
  const [providerDetails, setProviderDetails] = useState<Array<{ pluginId: string; items: Array<{ label: string; value?: string; url?: string }> }>>([])
  const placeIdForDetails = mode === 'trip' ? place?.id : undefined
  useEffect(() => {
    if (placeIdForDetails == null) { setProviderDetails([]); return }
    let cancelled = false
    pluginsApi.placeDetails(placeIdForDetails)
      .then((d) => { if (!cancelled) setProviderDetails((d.providers || []).filter((p) => Array.isArray(p.items) && p.items.length > 0)) })
      .catch(() => { if (!cancelled) setProviderDetails([]) })
    return () => { cancelled = true }
  }, [placeIdForDetails])
  const { t, locale, language } = useTranslation()
  // Currency-less prices mean "the trip's currency"; null in collection mode (EUR fallback below).
  const tripCurrency = useTripStore(s => s.trip?.currency)
  const toast = useToast()
  const timeFormat = useSettingsStore(s => s.settings.time_format) || '24h'
  const distanceUnit = useSettingsStore(s => s.settings.distance_unit) || 'metric'
  const collectionsEnabled = useAddonStore(s => s.isEnabled('collections'))
  const openSavePicker = useSaveToCollectionStore(s => s.open)
  const saveVersion = useSaveToCollectionStore(s => s.version)
  const [savedInCollection, setSavedInCollection] = useState(false)
  const [hoursExpanded, setHoursExpanded] = useState(false)
  const [filesExpanded, setFilesExpanded] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const googleDetails = usePlaceDetails(place?.google_place_id, place?.google_ftid, place?.osm_id, language)

  // Library-wide "is this place already saved anywhere I can see?" indicator for
  // the trip-planner footer bookmark. Re-checks when the place changes or after
  // the save picker reports a change (saveVersion bump).
  const showSaveToCollection = mode === 'trip' && collectionsEnabled
  useEffect(() => {
    if (!showSaveToCollection || !place) { setSavedInCollection(false); return }
    let cancelled = false
    collectionsApi.membership({
      google_place_id: place.google_place_id ?? undefined,
      google_ftid: place.google_ftid ?? undefined,
      name: place.name,
      lat: place.lat ?? undefined,
      lng: place.lng ?? undefined,
    }).then(m => { if (!cancelled) setSavedInCollection(m.saved) }).catch(() => { if (!cancelled) setSavedInCollection(false) })
    return () => { cancelled = true }
    // Re-check on place identity + after the picker reports a change; the other
    // place fields are read at fire-time only, like the existing detail caches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSaveToCollection, place?.id, saveVersion])

  const handleSaveToCollection = useCallback(() => {
    if (!place) return
    openSavePicker({
      name: place.name,
      source_trip_id: place.trip_id ?? null,
      source_place_id: place.id,
      description: place.description ?? null,
      lat: place.lat ?? null,
      lng: place.lng ?? null,
      address: place.address ?? null,
      category_id: place.category_id ?? null,
      price: place.price ?? null,
      currency: place.currency ?? null,
      notes: place.notes ?? null,
      image_url: place.image_url ?? null,
      google_place_id: place.google_place_id ?? null,
      google_ftid: place.google_ftid ?? null,
      osm_id: place.osm_id ?? null,
      website: place.website ?? null,
      phone: place.phone ?? null,
    })
  }, [place, openSavePicker])

  const startNameEdit = () => {
    if (!onUpdatePlace) return
    setNameValue(place.name || '')
    setEditingName(true)
    setTimeout(() => nameInputRef.current?.focus(), 0)
  }

  const commitNameEdit = () => {
    if (!editingName) return
    const trimmed = nameValue.trim()
    setEditingName(false)
    if (!trimmed || trimmed === place.name) return
    onUpdatePlace(place.id, { name: trimmed })
  }

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitNameEdit() }
    if (e.key === 'Escape') setEditingName(false)
  }

  if (!place) return null

  const category = categories?.find(c => c.id === place.category_id)
  const dayAssignments = selectedDayId ? (assignments[String(selectedDayId)] || []) : []
  const assignmentInDay = selectedDayId
    ? ((selectedAssignmentId ? dayAssignments.find(a => a.id === selectedAssignmentId) : null)
      ?? dayAssignments.find(a => a.place?.id === place.id))
    : null

  const openingHours = googleDetails?.opening_hours || null
  const openNow = googleDetails?.open_now ?? null
  // Prefer the place's stored ftid; if it has none yet, use the one just fetched from Google.
  const googleMapsUrl = getGoogleMapsUrlForPlace(
    { ...place, google_ftid: place.google_ftid || googleDetails?.google_ftid || null },
    googleDetails?.google_maps_url,
  )
  const openStreetMapUrl = getOpenStreetMapUrlForPlace(place)
  const displayAddress = cleanText(googleDetails?.written_address)
    || cleanText(googleDetails?.address_translated)
    || cleanText(googleDetails?.address)
    || place.address
  const translatedName = cleanText(googleDetails?.name_translated) || cleanText(googleDetails?.name)
  const originalName = cleanText(googleDetails?.name_original)
  const secondaryNames = uniqueNameParts(translatedName, originalName).filter(name => name !== place.name)
  const placeType = humanizeType(googleDetails?.type || googleDetails?.types?.[0] || googleDetails?.primary_type)
  const accessibility = Array.isArray(googleDetails?.accessibility) ? googleDetails.accessibility : []
  const reviews = Array.isArray(googleDetails?.reviews) ? googleDetails.reviews.filter(r => r?.text || r?.author) : []
  const popularTimes = Array.isArray(googleDetails?.popular_times) ? googleDetails.popular_times : []
  const popularStatus = cleanText(googleDetails?.popular_status)
  const photoCount = Array.isArray(googleDetails?.photos) ? googleDetails.photos.length : 0
  const phoneLabel = t('inspector.phone') === 'inspector.phone' ? 'Phone' : t('inspector.phone')
  const summaryText = place.description || googleDetails?.summary || ''
  const selectedDay = days?.find(d => d.id === selectedDayId)
  const weekdayIndex = getWeekdayIndex(selectedDay?.date)
  const normalizedScheduleMargin = Math.max(0, Math.round(Number(scheduleMarginMinutes) || 0))
  const scheduledSlot = useMemo(() => {
    if (!selectedDay || !assignmentInDay) return null
    const sortedAssignments = [...dayAssignments].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    const schedule = buildActivitySchedule(selectedDay, sortedAssignments, { scheduleMarginMinutes: normalizedScheduleMargin })
    return schedule[assignmentInDay.id] || null
  }, [assignmentInDay, dayAssignments, normalizedScheduleMargin, selectedDay])
  const popularSchedule = useMemo<PopularTimesSchedule>(() => {
    const day = selectedDay?.date ? getPopularWeekdayIndex(selectedDay.date) : null
    if (!scheduledSlot) return { day, startHour: null, endHour: null, label: null }
    const startMinutes = parseTimeToMinutes(scheduledSlot.start)
    const endMinutes = parseTimeToMinutes(scheduledSlot.end)
    if (startMinutes == null || endMinutes == null) return { day, startHour: null, endHour: null, label: null }
    const endAbsolute = endMinutes > startMinutes ? endMinutes : endMinutes + 24 * 60
    return {
      day,
      startHour: Math.floor(startMinutes / 60),
      endHour: Math.max(Math.floor(startMinutes / 60) + 1, Math.ceil(endAbsolute / 60)),
      label: `${formatTime(scheduledSlot.start, locale, timeFormat)} - ${formatTime(scheduledSlot.end, locale, timeFormat)}`,
    }
  }, [locale, scheduledSlot, selectedDay?.date, timeFormat])

  const placeFiles = (files || []).filter(f => String(f.place_id) === String(place.id) || (f.linked_place_ids || []).includes(place.id))

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])
    if (!selectedFiles.length || !onFileUpload) return
    setIsUploading(true)
    try {
      for (const file of selectedFiles) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('place_id', String(place.id))
        await onFileUpload(fd)
      }
      setFilesExpanded(true)
    } catch (err: unknown) {
      console.error('Upload failed', err)
      toast.error(translateApiError(t, err, 'files.uploadError'))
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [onFileUpload, place.id, toast, t])

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: `calc(${leftWidth}px + (100% - ${leftWidth}px - ${rightWidth}px) / 2)`,
        transform: 'translateX(-50%)',
        width: `min(800px, calc(100% - ${leftWidth}px - ${rightWidth}px - 32px))`,
        zIndex: 50,
        fontFamily: "var(--font-system)",
      }}
    >
      <div className="flex max-h-[60vh] flex-col overflow-hidden rounded-[20px] bg-surface-elevated shadow-[0_8px_40px_rgba(0,0,0,0.14),0_0_0_1px_rgba(0,0,0,0.06)] [backdrop-filter:blur(40px)_saturate(180%)] [-webkit-backdrop-filter:blur(40px)_saturate(180%)]">
        {/* Header */}
        <PlaceInspectorHeader openNow={openNow} place={place} category={category} t={t} editingName={editingName}
          nameInputRef={nameInputRef} nameValue={nameValue} setNameValue={setNameValue} commitNameEdit={commitNameEdit}
          handleNameKeyDown={handleNameKeyDown} startNameEdit={startNameEdit} onUpdatePlace={onUpdatePlace}
          onClose={onClose} secondaryNames={secondaryNames} displayAddress={displayAddress} />

        {/* Content */}
        <div data-testid="inspector-scroll" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden px-4 py-3">

          {/* Info-Chips — hidden on mobile, shown on desktop */}
          <div className="hidden shrink-0 flex-wrap items-center gap-1.5 sm:flex">
            {placeType && (
              <Chip icon={<Info size={12} />} text={placeType} color="var(--text-secondary)" bg="var(--bg-hover)" />
            )}
            {googleDetails?.rating && (
              <Chip
                icon={<Star size={12} fill="#facc15" color="#facc15" />}
                text={<>
                  {googleDetails.rating.toFixed(1)}
                  {googleDetails.rating_count ? <span className="opacity-50"> ({googleDetails.rating_count.toLocaleString(locale)})</span> : null}
                </>}
                color="var(--text-secondary)" bg="var(--bg-hover)"
              />
            )}
            {place.price > 0 && (
              <Chip icon={<Banknote size={12} />} text={formatMoney(Number(place.price) || 0, place.currency || tripCurrency || 'EUR', locale)} color="#059669" bg="#ecfdf5" />
            )}
            {googleDetails?.accessible !== null && googleDetails?.accessible !== undefined && (
              <Chip
                icon={<Accessibility size={12} />}
                text={googleDetails.accessible ? t('inspector.accessible') : t('inspector.accessibilityLimited')}
                color={googleDetails.accessible ? '#047857' : '#b45309'}
                bg={googleDetails.accessible ? '#ecfdf5' : '#fffbeb'}
              />
            )}
          </div>

          <PlacePhotoPreview place={place} details={googleDetails} photoCount={photoCount} t={t} />

          <div data-testid="inspector-info-scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 [-webkit-overflow-scrolling:touch]">
            <div data-testid="inspector-info-columns" className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-start">
              <div data-testid="inspector-info-left" className="min-w-0">
                {assignmentInDay && selectedDayId && (
                  <AssignmentDurationControl
                    assignment={assignmentInDay}
                    dayId={selectedDayId}
                    placeDurationMinutes={place.duration_minutes}
                    onUpdateAssignmentDuration={onUpdateAssignmentDuration}
                    t={t}
                  />
                )}

                <AccessibilityDetailsBlock accessibility={accessibility} t={t} />

                {/* Phone */}
                {(place.phone || googleDetails?.phone) && (
                  <InfoBlock>
                    <InfoBlockHeader icon={<Phone size={13} className="text-content-faint" />} title={phoneLabel} />
                    <a
                      href={`tel:${place.phone || googleDetails.phone}`}
                      className="inline-flex items-center gap-1 text-xs text-content no-underline [word-break:break-word]"
                    >
                      {place.phone || googleDetails.phone}
                    </a>
                  </InfoBlock>
                )}

                {/* Notes */}
                {place.notes && (
                  <InfoBlock className="collab-note-md text-xs leading-[1.5] text-content-muted [overflow-wrap:anywhere] [word-break:break-word]">
                    <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{place.notes}</Markdown>
                  </InfoBlock>
                )}

                {mode === 'trip' && (
                  <PlaceReservationParticipants selectedAssignmentId={selectedAssignmentId} reservations={reservations}
                    assignments={assignments} selectedDayId={selectedDayId} tripMembers={tripMembers} locale={locale}
                    timeFormat={timeFormat} t={t} onSetParticipants={onSetParticipants} />
                )}

                <PlaceExtras openingHours={openingHours} weekdayIndex={weekdayIndex} hoursExpanded={hoursExpanded}
                  setHoursExpanded={setHoursExpanded} timeFormat={timeFormat} t={t} place={place} placeFiles={placeFiles}
                  onFileUpload={onFileUpload} filesExpanded={filesExpanded} setFilesExpanded={setFilesExpanded}
                  fileInputRef={fileInputRef} handleFileUpload={handleFileUpload} isUploading={isUploading}
                  distanceUnit={distanceUnit} />
              </div>

              <div data-testid="inspector-info-right" className="min-w-0">
                {/* Description / Summary */}
                {summaryText && (
                  <InfoBlock testId="inspector-summary" className="collab-note-md text-xs leading-[1.5] text-content-muted [overflow-wrap:anywhere] [word-break:break-word]">
                    <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{summaryText}</Markdown>
                  </InfoBlock>
                )}

                <GoogleDetailsSections
                  reviews={reviews}
                  popularTimes={popularTimes}
                  popularStatus={popularStatus}
                  popularSchedule={popularSchedule}
                  locale={locale}
                  timeFormat={timeFormat}
                  t={t}
                />
              </div>
            </div>
          </div>

          {/* Extra native rows from placeDetailProvider plugins (#1429). */}
          {mode === 'trip' && providerDetails.length > 0 && (
            <div className="bg-surface-hover" style={{ borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {providerDetails.flatMap((p) => p.items.map((it, i) => (
                <div key={`${p.pluginId}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 'calc(12.5px * var(--fs-scale-body, 1))' }}>
                  <span className="text-content-secondary" style={{ fontWeight: 500, flexShrink: 0 }}>{it.label}</span>
                  {it.url
                    ? <a href={it.url} target="_blank" rel="noreferrer noopener" className="text-accent" style={{ textDecoration: 'none', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.value ?? '↗'}</a>
                    : <span className="text-content-muted" style={{ textAlign: 'right' }}>{it.value}</span>}
                </div>
              )))}
            </div>
          )}

          {/* Place-detail plugin slots (#1429): sandboxed, scoped to this place. */}
          {mode === 'trip' && placeDetailPlugins.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {placeDetailPlugins.map((p) => {
                const tid = (place as { trip_id?: number | string }).trip_id
                return (
                  <div key={p.id} className="bg-surface-hover" style={{ borderRadius: 10, overflow: 'hidden' }}>
                    <PluginFrame pluginId={p.id} tripId={tid != null ? String(tid) : null} placeId={String(place.id)} title={p.name} />
                  </div>
                )
              })}
            </div>
          )}

        </div>

        {/* Footer actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-edge-faint px-4 py-2.5">
          {/* Collection mode — copy to trip + per-place status */}
          {mode === 'collection' && onCopyToTrip && (
            <ActionButton onClick={onCopyToTrip} variant="primary" icon={<Copy size={13} />}
              label={<span className="hidden sm:inline">{t('collections.copyToTrip')}</span>} />
          )}
          {mode === 'collection' && collectionStatus && onSetStatus && (
            <StatusBadge status={collectionStatus} onChange={onSetStatus} t={t} />
          )}
          {/* Trip mode — day assignment */}
          {mode === 'trip' && selectedDayId && (
            assignmentInDay ? (
              <ActionButton onClick={() => onRemoveAssignment?.(selectedDayId, assignmentInDay.id)} variant="ghost" icon={<Minus size={13} />}
                label={<span className="hidden sm:inline">{t('inspector.removeFromDay')}</span>} />
            ) : (
              <ActionButton onClick={() => onAssignToDay?.(place.id)} variant="primary" icon={<Plus size={13} />} label={t('inspector.addToDay')} />
            )
          )}
          {/* Save to Collection — trip mode, independent of the Google Maps link */}
          {showSaveToCollection && (
            <ActionButton onClick={handleSaveToCollection} variant="ghost"
              icon={savedInCollection ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
              label={<span className="hidden sm:inline">{savedInCollection ? t('inspector.savedToCollection') : t('inspector.saveToCollection')}</span>} />
          )}
          {googleMapsUrl && (
            <ActionButton onClick={() => window.open(googleMapsUrl, '_blank')} variant="ghost" icon={<Navigation size={13} />}
              label={<span className="hidden sm:inline">{t('inspector.google')}</span>} />
          )}
          {openStreetMapUrl && (
            <ActionButton onClick={() => window.open(openStreetMapUrl, '_blank')} variant="ghost" icon={<MapIcon size={13} />}
              label={<span className="hidden sm:inline">{t('inspector.openStreetMap')}</span>} />
          )}
          {(place.website || googleDetails?.website) && (
            <ActionButton onClick={() => window.open(place.website || googleDetails?.website, '_blank')} variant="ghost" icon={<ExternalLink size={13} />}
              label={<span className="hidden sm:inline">{t('inspector.website')}</span>} />
          )}
          <div className="flex-1" />
          {mode === 'trip' && onEdit && (
            <ActionButton onClick={onEdit} variant="ghost" icon={<Edit2 size={13} />} label={<span className="hidden sm:inline">{t('common.edit')}</span>} />
          )}
          {mode === 'collection'
            ? (onRemoveFromList && (
                <ActionButton onClick={onRemoveFromList} variant="danger" icon={<Trash2 size={13} />}
                  label={<span className="hidden sm:inline">{t('collections.removeFromList')}</span>} />
              ))
            : (onDelete && (
                <ActionButton onClick={onDelete} variant="danger" icon={<Trash2 size={13} />} label={<span className="hidden sm:inline">{t('common.delete')}</span>} />
              ))}
        </div>
      </div>
    </div>
  )
}

interface ChipProps {
  icon: React.ReactNode
  text: React.ReactNode
  color?: string
  bg?: string
}

function Chip({ icon, text, color = 'var(--text-secondary)', bg = 'var(--bg-hover)' }: ChipProps) {
  return (
    <div
      className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-full px-[9px] py-[3px] text-xs"
      style={{ background: bg, color }}
    >
      <span className="flex shrink-0">{icon}</span>
      <span className="truncate">{text}</span>
    </div>
  )
}

interface InfoBlockProps {
  children: React.ReactNode
  className?: string
  testId?: string
}

function InfoBlock({ children, className = '', testId }: InfoBlockProps) {
  return (
    <div data-testid={testId} className={`${INFO_BLOCK_CLASS}${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}

interface InfoBlockHeaderProps {
  icon: React.ReactNode
  title: React.ReactNode
  className?: string
}

function InfoBlockHeader({ icon, title, className = '' }: InfoBlockHeaderProps) {
  return (
    <div className={`${INFO_BLOCK_HEADER_CLASS}${className ? ` ${className}` : ''}`}>
      {icon} {title}
    </div>
  )
}

function InfoBlockLabel({ icon, title, htmlFor }: InfoBlockHeaderProps & { htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className={INFO_BLOCK_HEADER_CLASS}>
      {icon} {title}
    </label>
  )
}

function PlacePhotoPreview({ place, details, photoCount, t }: { place: Place; details: Record<string, unknown> | null; photoCount: number; t: TFunction }) {
  const [photoUrl, setPhotoUrl] = useState(place.image_url || null)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const directPhotoUrls = uniquePhotoUrls(Array.isArray(details?.photos) ? details.photos : [])
  const photoUrls = uniquePhotoUrls(place.image_url, directPhotoUrls, photoUrl)
  const lightboxPhotos = photoUrls.map((url, index) => ({
    id: `${place.id}-${index}-${url}`,
    src: url,
    caption: place.name,
  }))
  const photoId = cleanText(details?.google_place_id)
    || cleanText(details?.google_ftid)
    || cleanText(place.google_place_id)
    || cleanText(place.google_ftid)
    || cleanText(place.osm_id)
  const photoLat = typeof details?.lat === 'number' ? details.lat : place.lat
  const photoLng = typeof details?.lng === 'number' ? details.lng : place.lng
  const photoName = cleanText(details?.name) || place.name

  useEffect(() => {
    let cancelled = false
    setPhotoUrl(place.image_url || null)
    if (place.image_url || directPhotoUrls.length > 0 || !photoId) return () => { cancelled = true }
    mapsApi.placePhoto(photoId, photoLat ?? undefined, photoLng ?? undefined, photoName)
      .then(data => {
        if (!cancelled && data?.photoUrl) setPhotoUrl(data.photoUrl)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [photoId, place.id, place.image_url, photoLat, photoLng, photoName, directPhotoUrls.length])

  if (photoUrls.length === 0) return null
  const displayedPhotoCount = Math.max(photoCount, photoUrls.length)

  return (
    <>
      <div className="shrink-0 overflow-hidden rounded-lg border border-edge-faint bg-surface-hover">
        <div className="flex snap-x snap-proximity gap-2 overflow-x-auto overscroll-x-contain p-2 [-webkit-overflow-scrolling:touch]">
          {photoUrls.map((url, index) => (
            <button
              key={url}
              type="button"
              aria-label={t('inspector.openPhoto', { index: index + 1, count: photoUrls.length })}
              onClick={() => setLightboxIndex(index)}
              className="relative h-[126px] flex-[0_0_min(72vw,210px)] shrink-0 snap-start overflow-hidden rounded-[7px] border-0 bg-surface-hover p-0 text-left"
            >
              <img src={url} alt={place.name} loading={index === 0 ? 'eager' : 'lazy'} className="block h-full w-full object-cover transition-transform duration-150 hover:scale-[1.02]" />
              {index === 0 && displayedPhotoCount > 1 && (
                <div className="absolute bottom-[7px] right-[7px] inline-flex items-center gap-1 rounded-full bg-[rgba(0,0,0,0.58)] px-[7px] py-[3px] text-[11px] font-semibold text-white">
                  <ImageIcon size={12} /> {t('inspector.photosCount', { count: displayedPhotoCount })}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
      {lightboxIndex !== null && (
        ReactDOM.createPortal(
          <PhotoLightbox
            key={`${place.id}-${lightboxIndex}`}
            photos={lightboxPhotos}
            startIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />,
          document.body,
        )
      )}
    </>
  )
}

function AccessibilityDetailsBlock({ accessibility, t }: {
  accessibility: Array<{ key?: string; label?: string; value?: boolean | null; text?: string | null }>
  t: TFunction
}) {
  if (accessibility.length === 0) return null

  return (
    <InfoBlock testId="inspector-accessibility">
      <InfoBlockHeader icon={<Accessibility size={13} className="text-content-faint" />} title={t('inspector.accessibility')} />
      <div className="flex flex-col gap-1">
        {accessibility.map((feature, idx) => (
          <div key={`${feature.key || feature.label || idx}`} className="flex items-start gap-1.5 text-xs leading-[1.35] text-content-muted">
            <span className={`font-bold ${feature.value === true ? 'text-[#16a34a]' : feature.value === false ? 'text-[#d97706]' : 'text-content-faint'}`}>
              {feature.value === true ? '✓' : feature.value === false ? '–' : '•'}
            </span>
            <span>{feature.text || feature.label}</span>
          </div>
        ))}
      </div>
    </InfoBlock>
  )
}

function GoogleDetailsSections({ reviews, popularTimes, popularStatus, popularSchedule, locale, timeFormat, t }: {
  reviews: Array<{ author?: string | null; rating?: number | null; text?: string | null; time?: string | null; published_at?: string | null; photo?: string | null; uri?: string | null }>
  popularTimes: Array<{ day: number; hour: number; occupancy_percent: number }>
  popularStatus?: string | null
  popularSchedule?: PopularTimesSchedule | null
  locale: string
  timeFormat: string
  t: TFunction
}) {
  const showReviews = reviews.length > 0
  const showPopularTimes = popularTimes.length > 0 || Boolean(popularStatus)
  const [popularExpanded, setPopularExpanded] = useState(false)
  const [reviewsOpen, setReviewsOpen] = useState(false)

  useEffect(() => {
    setPopularExpanded(false)
  }, [popularSchedule?.day, popularSchedule?.startHour, popularSchedule?.endHour, popularTimes.length, popularStatus])

  if (!showReviews && !showPopularTimes) return null

  const popularByDay = new Map<number, Array<{ hour: number; occupancy_percent: number }>>()
  for (const item of popularTimes) {
    if (!popularByDay.has(item.day)) popularByDay.set(item.day, [])
    popularByDay.get(item.day)!.push(item)
  }
  const orderedPopularDays = [1, 2, 3, 4, 5, 6, 0].filter(day => popularByDay.has(day))
  const scheduledDay = popularSchedule?.day ?? null
  const collapsedPopularDay = scheduledDay != null && popularByDay.has(scheduledDay)
    ? scheduledDay
    : (orderedPopularDays[0] ?? null)
  const visiblePopularDays = popularExpanded ? orderedPopularDays : (collapsedPopularDay != null ? [collapsedPopularDay] : [])
  const canExpandPopular = orderedPopularDays.length > 1
  const collapsedSummary = collapsedPopularDay != null
    ? [
      weekdayName(collapsedPopularDay, locale),
      popularSchedule?.day === collapsedPopularDay ? popularSchedule.label : null,
    ].filter(Boolean).join(' · ')
    : null

  return (
    <>
      {showReviews && (
        <InfoBlock testId="inspector-reviews">
          <button
            type="button"
            onClick={() => setReviewsOpen(true)}
            className="mb-1.5 flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent p-0 text-left font-[inherit]"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-content-secondary">
              <MessageSquare size={13} className="text-content-faint" /> {t('inspector.reviews')}
            </span>
            <span className="text-[10px] font-medium text-content-faint">
              {t('inspector.reviewsCount', { count: reviews.length })}
            </span>
          </button>
          <div className="flex flex-col gap-2">
            {reviews.slice(0, 2).map((review, idx) => (
              <button
                key={`${review.author || 'review'}-${idx}`}
                type="button"
                onClick={() => setReviewsOpen(true)}
                className="block min-w-0 cursor-pointer rounded-md border-0 bg-transparent p-0 text-left font-[inherit] transition-colors hover:bg-surface-tertiary"
              >
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-content">
                  {review.rating ? <><Star size={11} fill="#facc15" className="text-[#facc15]" /> {review.rating}</> : null}
                  {review.author && <span className="truncate">{review.author}</span>}
                  {review.time && <span className="font-normal text-content-faint">{review.time}</span>}
                </div>
                {review.text && (
                  <div className="mt-0.5 overflow-hidden text-xs leading-[1.4] text-content-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
                    {review.text}
                  </div>
                )}
              </button>
            ))}
            {reviews.length > 2 && (
              <button
                type="button"
                onClick={() => setReviewsOpen(true)}
                className="mt-0.5 inline-flex w-fit cursor-pointer items-center gap-1 rounded-md border-0 bg-surface-tertiary px-2 py-1 text-[11px] font-semibold text-content-secondary hover:bg-surface-card"
              >
                {t('inspector.viewAllReviews', { count: reviews.length })}
              </button>
            )}
          </div>
        </InfoBlock>
      )}
      {reviewsOpen && (
        <ReviewsPanel reviews={reviews} onClose={() => setReviewsOpen(false)} t={t} />
      )}

      {showPopularTimes && (
        <InfoBlock>
          <button
            type="button"
            disabled={!canExpandPopular}
            aria-expanded={canExpandPopular ? popularExpanded : undefined}
            onClick={() => { if (canExpandPopular) setPopularExpanded(v => !v) }}
            className="mb-2 flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent p-0 text-left font-[inherit] disabled:cursor-default"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-content-secondary">
              <BarChart3 size={13} className="shrink-0 text-content-faint" /> {t('inspector.popularTimes')}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              {!popularExpanded && collapsedSummary && (
                <span className="truncate text-[10px] font-medium text-content-faint">{collapsedSummary}</span>
              )}
              {canExpandPopular && (
                popularExpanded
                  ? <ChevronUp size={13} className="shrink-0 text-content-faint" />
                  : <ChevronDown size={13} className="shrink-0 text-content-faint" />
              )}
            </span>
          </button>
          {popularStatus && (
            <div className="mb-[7px] text-[11px] leading-[1.35] text-content-muted">
              {popularStatus}
            </div>
          )}
          <div className="flex flex-col gap-[5px]">
            {visiblePopularDays.map(day => {
              const values = (popularByDay.get(day) || []).slice().sort((a, b) => a.hour - b.hour)
              if (values.length === 0) return null
              const peak = Math.max(...values.map(v => v.occupancy_percent))
              const byHour = new Map(values.map(v => [v.hour, v.occupancy_percent]))
              const isScheduledDay = popularSchedule?.day === day
              return (
                <div key={day} data-testid={`popular-times-day-${day}`} className="grid grid-cols-[34px_minmax(0,1fr)_34px] items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-content-faint">{weekdayName(day, locale)}</span>
                  <div className="grid h-7 grid-cols-[repeat(24,minmax(2px,1fr))] items-end gap-0.5">
                    {Array.from({ length: 24 }, (_, hour) => {
                      const percent = byHour.get(hour) ?? 0
                      const scheduled = isScheduledPopularHour(day, hour, popularSchedule)
                      const hourLabel = formatTime(`${String(hour).padStart(2, '0')}:00`, locale, timeFormat)
                      const tooltip = `${weekdayName(day, locale)} ${hourLabel} · ${percent}%`
                      const barHeight = scheduled
                        ? Math.max(8, percent > 0 ? Math.max(5, percent * 0.28) : 3)
                        : (percent > 0 ? Math.max(5, percent * 0.28) : 3)
                      return (
                        <div key={`${day}-${hour}`} className="group relative flex h-7 items-end" title={tooltip}>
                          <div
                            data-testid={`popular-time-slot-${day}-${hour}`}
                            aria-label={tooltip}
                            className="w-full rounded-sm transition-[height,background]"
                            style={{
                              height: `${barHeight}px`,
                              background: popularBarBackground(percent, peak, scheduled),
                            }}
                          />
                          <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-content px-1.5 py-1 text-[10px] font-semibold text-surface shadow-lg group-hover:block">
                            {tooltip}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <span className="text-right text-[10px] text-content-faint">{peak}%</span>
                </div>
              )
            })}
          </div>
        </InfoBlock>
      )}
    </>
  )
}

function ReviewsPanel({ reviews, onClose, t }: {
  reviews: Array<{ author?: string | null; rating?: number | null; text?: string | null; time?: string | null; published_at?: string | null; photo?: string | null; uri?: string | null }>
  onClose: () => void
  t: TFunction
}) {
  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/45 p-3 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('inspector.reviews')}
        className="flex max-h-[min(680px,calc(100vh-32px))] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl bg-surface-elevated shadow-[0_18px_60px_rgba(0,0,0,0.28)] [backdrop-filter:blur(28px)_saturate(180%)] [-webkit-backdrop-filter:blur(28px)_saturate(180%)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-edge-faint px-4 py-3">
          <MessageSquare size={16} className="text-content-faint" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-content">{t('inspector.reviews')}</div>
            <div className="text-xs text-content-faint">{t('inspector.reviewsCount', { count: reviews.length })}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-surface-hover text-content-secondary hover:bg-surface-tertiary"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-3">
            {reviews.map((review, idx) => (
              <div key={`${review.author || 'review'}-${idx}`} className="rounded-lg bg-surface-hover px-3 py-2.5">
                <div className="flex items-start gap-2">
                  {review.photo ? (
                    <img src={review.photo} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-xs font-bold text-content-muted">
                      {review.author?.trim()?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                      {review.author && <span className="min-w-0 truncate text-xs font-semibold text-content">{review.author}</span>}
                      {review.rating ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-content-secondary">
                          <Star size={11} fill="#facc15" className="text-[#facc15]" /> {review.rating}
                        </span>
                      ) : null}
                      {review.time && <span className="text-[11px] text-content-faint">{review.time}</span>}
                    </div>
                    {review.text && (
                      <div className="mt-1 whitespace-pre-wrap text-xs leading-[1.45] text-content-muted [overflow-wrap:anywhere]">
                        {review.text}
                      </div>
                    )}
                    {review.uri && (
                      <a
                        href={review.uri}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-content-secondary no-underline hover:text-content"
                      >
                        {t('inspector.openReview')} <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

interface AssignmentDurationControlProps {
  assignment: Assignment
  dayId: number
  placeDurationMinutes?: number | null
  onUpdateAssignmentDuration?: (assignmentId: number, dayId: number, durationMinutes: number) => Promise<void> | void
  t: TFunction
}

function AssignmentDurationControl({
  assignment,
  dayId,
  placeDurationMinutes,
  onUpdateAssignmentDuration,
  t,
}: AssignmentDurationControlProps) {
  const toast = useToast()
  const currentMinutes = parseDurationMinutes(
    assignment.duration_minutes ?? assignment.place?.duration_minutes ?? placeDurationMinutes,
  ) ?? 60
  const inputId = `assignment-duration-${assignment.id}`
  const [value, setValue] = useState(formatDurationInput(currentMinutes))
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setValue(formatDurationInput(currentMinutes))
  }, [assignment.id, currentMinutes])

  const commitDuration = useCallback(async () => {
    const parsed = parseDurationMinutes(value)
    if (parsed == null) {
      setValue(formatDurationInput(currentMinutes))
      toast.error(t('places.durationInvalid'))
      return
    }
    if (parsed === currentMinutes) {
      setValue(formatDurationInput(parsed))
      return
    }
    if (!onUpdateAssignmentDuration) return

    setIsSaving(true)
    try {
      await onUpdateAssignmentDuration(assignment.id, dayId, parsed)
      setValue(formatDurationInput(parsed))
    } catch (err: unknown) {
      setValue(formatDurationInput(currentMinutes))
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setIsSaving(false)
    }
  }, [
    assignment.id,
    currentMinutes,
    dayId,
    onUpdateAssignmentDuration,
    t,
    toast,
    value,
  ])

  const scheduledDurationLabel = t('inspector.scheduledDuration') === 'inspector.scheduledDuration'
    ? 'Scheduled Duration'
    : t('inspector.scheduledDuration')

  return (
    <InfoBlock>
      <InfoBlockLabel htmlFor={inputId} icon={<Clock size={13} className="text-content-faint" />} title={scheduledDurationLabel} />
      <input
        id={inputId}
        type="text"
        inputMode="text"
        value={value}
        disabled={!onUpdateAssignmentDuration || isSaving}
        onChange={e => setValue(e.target.value)}
        onBlur={() => { void commitDuration() }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            setValue(formatDurationInput(currentMinutes))
            e.currentTarget.blur()
          }
        }}
        placeholder={t('places.durationPlaceholder')}
        className="form-input w-full text-xs"
      />
    </InfoBlock>
  )
}

interface ActionButtonProps {
  onClick: () => void
  variant: 'primary' | 'ghost' | 'danger'
  icon: React.ReactNode
  label: React.ReactNode
}

export function ActionButton({ onClick, variant, icon, label }: ActionButtonProps) {
  const variantClass = {
    primary: 'bg-accent text-accent-text hover:bg-[var(--text-secondary)]',
    ghost: 'bg-surface-hover text-content-secondary hover:bg-surface-tertiary',
    danger: 'bg-[rgba(239,68,68,0.08)] text-[#dc2626] hover:bg-[rgba(239,68,68,0.16)]',
  }
  return (
    <button
      onClick={onClick}
      className={`flex min-h-[30px] cursor-pointer items-center gap-1.5 rounded-[10px] border-0 px-3 py-1.5 font-[inherit] text-xs font-medium transition-[background,opacity] ${variantClass[variant] || variantClass.ghost}`}
    >
      {icon}{label}
    </button>
  )
}

interface ParticipantsBoxProps {
  tripMembers: TripMember[]
  participantIds: number[]
  allJoined: boolean
  onSetParticipants: (assignmentId: number, dayId: number, participantIds: number[]) => void
  selectedAssignmentId: number | null
  selectedDayId: number | null
  t: (key: string) => string
}

function ParticipantsBox({ tripMembers, participantIds, allJoined, onSetParticipants, selectedAssignmentId, selectedDayId, t }: ParticipantsBoxProps) {
  const [showAdd, setShowAdd] = useState(false)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  // Active participants: if allJoined, show all members; otherwise show only those in participantIds
  const activeMembers = allJoined ? tripMembers : tripMembers.filter(m => participantIds.includes(m.id))
  const availableToAdd = allJoined ? [] : tripMembers.filter(m => !participantIds.includes(m.id))

  const handleRemove = (userId: number) => {
    if (selectedAssignmentId == null || selectedDayId == null) return
    let newIds: number[]
    if (allJoined) {
      newIds = tripMembers.filter(m => m.id !== userId).map(m => m.id)
    } else {
      newIds = participantIds.filter(id => id !== userId)
    }
    if (newIds.length === tripMembers.length) newIds = []
    onSetParticipants(selectedAssignmentId, selectedDayId, newIds)
  }

  const handleAdd = (userId: number) => {
    if (selectedAssignmentId == null || selectedDayId == null) return
    const newIds = [...participantIds, userId]
    if (newIds.length === tripMembers.length) {
      onSetParticipants(selectedAssignmentId, selectedDayId, [])
    } else {
      onSetParticipants(selectedAssignmentId, selectedDayId, newIds)
    }
    setShowAdd(false)
  }

  return (
    <div className="mb-2 break-inside-avoid rounded-xl border border-edge-faint px-2.5 py-2">
      <div className="mb-1.5 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.03em] text-content-faint">
        <Users size={10} /> {t('inspector.participants')}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {activeMembers.map(member => {
          const isHovered = hoveredId === member.id
          const canRemove = activeMembers.length > 1
          return (
            <div key={member.id}
              onMouseEnter={() => setHoveredId(member.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => { if (canRemove) handleRemove(member.id) }}
              className={`${isHovered && canRemove ? 'border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.06)] text-[#ef4444]' : 'border-accent bg-surface-hover text-content'} ${canRemove ? 'cursor-pointer' : 'cursor-default'} inline-flex rounded-full border-[1.5px]`}
            >
              <div className="flex items-center gap-1 rounded-full py-0.5 pl-[3px] pr-[7px] text-[10px] font-medium transition-all">
                <div className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-tertiary text-[7px] font-bold text-content-muted">
                  {(member.avatar_url || member.avatar) ? <img src={member.avatar_url || avatarSrc(member.avatar)!} className="h-full w-full object-cover" /> : member.username?.[0]?.toUpperCase()}
                </div>
                <span className={isHovered && canRemove ? 'line-through' : undefined}>{member.username}</span>
              </div>
            </div>
          )
        })}

        {/* Add button */}
        {availableToAdd.length > 0 && (
          <div className="relative">
            <button onClick={() => setShowAdd(!showAdd)} className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-full border-[1.5px] border-dashed border-edge bg-transparent text-xs text-content-faint transition-all hover:border-content-muted hover:text-content">+</button>

            {showAdd && (
              <div className="absolute left-0 top-[26px] z-[100] min-w-[140px] rounded-[10px] border border-edge bg-surface-card p-1 shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
                {availableToAdd.map(member => (
                  <button key={member.id} onClick={() => handleAdd(member.id)} className="flex w-full cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 py-[5px] text-left font-[inherit] text-[11px] text-content transition-colors hover:bg-surface-hover">
                    <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-tertiary text-[8px] font-bold text-content-muted">
                      {(member.avatar_url || member.avatar) ? <img src={member.avatar_url || avatarSrc(member.avatar)!} className="h-full w-full object-cover" /> : member.username?.[0]?.toUpperCase()}
                    </div>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.username}</span>
                    {member.is_guest && <GuestBadge size="xs" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface PlaceInspectorHeaderProps {
  openNow: boolean | null
  place: Place
  category?: Category
  t: TFunction
  editingName: boolean
  nameInputRef: React.RefObject<HTMLInputElement | null>
  nameValue: string
  setNameValue: React.Dispatch<React.SetStateAction<string>>
  commitNameEdit: () => void
  handleNameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  startNameEdit: () => void
  onUpdatePlace: PlaceInspectorProps['onUpdatePlace']
  onClose: () => void
  secondaryNames: string[]
  displayAddress?: string | null
}

function PlaceInspectorHeader({ openNow, place, category, t, editingName, nameInputRef, nameValue, setNameValue,
  commitNameEdit, handleNameKeyDown, startNameEdit, onUpdatePlace, onClose, secondaryNames, displayAddress }: PlaceInspectorHeaderProps) {
  return (
        <div style={{ display: 'flex', alignItems: 'center', gap: openNow !== null ? 26 : 14, padding: openNow !== null ? '18px 16px 14px 28px' : '18px 16px 14px', borderBottom: '1px solid var(--border-faint)', flexShrink: 0 }}>
          {/* Avatar with open/closed ring + tag */}
          <div style={{ position: 'relative', flexShrink: 0, marginBottom: openNow !== null ? 8 : 0 }}>
            <div style={{
              borderRadius: '50%', padding: 2.5,
              background: openNow === true ? '#22c55e' : openNow === false ? '#ef4444' : 'transparent',
            }}>
              <PlaceAvatar place={place} category={category} size={52} />
            </div>
            {openNow !== null && (
              <span style={{
                position: 'absolute', bottom: -7, left: '50%', transform: 'translateX(-50%)',
                fontSize: 'calc(9px * var(--fs-scale-caption, 1))', fontWeight: 500, letterSpacing: '0.02em',
                color: 'white',
                background: openNow ? '#16a34a' : '#dc2626',
                padding: '1.5px 7px', borderRadius: 99,
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
              }}>
                {openNow ? t('inspector.opened') : t('inspector.closed')}
              </span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {editingName ? (
                <input
                  ref={nameInputRef}
                  value={nameValue}
                  onChange={e => setNameValue(e.target.value)}
                  onBlur={commitNameEdit}
                  onKeyDown={handleNameKeyDown}
                  className="text-content bg-surface-secondary"
                  style={{ fontWeight: 600, fontSize: 'calc(15px * var(--fs-scale-subtitle, 1))', lineHeight: '1.3', border: '1px solid var(--border-primary)', borderRadius: 6, padding: '1px 6px', fontFamily: 'inherit', outline: 'none', width: '100%' }}
                />
              ) : (
                <span
                  onDoubleClick={startNameEdit}
                  className="text-content"
                  style={{ fontWeight: 600, fontSize: 'calc(15px * var(--fs-scale-subtitle, 1))', lineHeight: '1.3', cursor: onUpdatePlace ? 'text' : 'default' }}
                >{place.name}</span>
              )}
              {category && (() => {
                const CatIcon = getCategoryIcon(category.icon)
                const emojiIcon = isEmojiCategoryIcon(category.icon) ? category.icon : null
                return (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 'calc(11px * var(--fs-scale-caption, 1))', fontWeight: 500,
                    color: category.color || '#6b7280',
                    background: category.color ? `${category.color}18` : 'rgba(0,0,0,0.06)',
                    border: `1px solid ${category.color ? `${category.color}30` : 'transparent'}`,
                    padding: '2px 8px', borderRadius: 99,
                  }}>
                    {emojiIcon ? (
                      <span style={{ fontSize: 10, lineHeight: 1 }}>{emojiIcon}</span>
                    ) : (
                      <CatIcon size={10} />
                    )}
                    <span className="hidden sm:inline">{category.name}</span>
                  </span>
                )
              })()}
            </div>
            {!editingName && secondaryNames?.length > 0 && (
              <div className="text-content-muted" style={{ fontSize: 12, lineHeight: 1.35, marginTop: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {secondaryNames.map(name => (
                  <span key={name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                ))}
              </div>
            )}
            {displayAddress && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginTop: 6 }}>
                <MapPin size={11} color="var(--text-faint)" style={{ flexShrink: 0, marginTop: 2 }} />
                <span className="text-content-muted" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', lineHeight: '1.4', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{displayAddress}</span>
              </div>
            )}
            {place.place_time && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <Clock size={10} color="var(--text-faint)" style={{ flexShrink: 0 }} />
                <span className="text-content-muted" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))' }}>{formatTime(place.place_time, locale, timeFormat)}{place.end_time ? ` – ${formatTime(place.end_time, locale, timeFormat)}` : ''}</span>
              </div>
            )}
            {place.lat && place.lng && (
              <div className="hidden sm:block text-content-faint" style={{ fontSize: 'calc(11px * var(--fs-scale-caption, 1))', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                {Number(place.lat).toFixed(6)}, {Number(place.lng).toFixed(6)}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="bg-surface-hover"
            style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-start', transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-hover)'}
          >
            <X size={14} strokeWidth={2} color="var(--text-secondary)" />
          </button>
        </div>
  )
}

interface PlaceReservationParticipantsProps {
  selectedAssignmentId: number | null
  reservations: Reservation[]
  assignments: AssignmentsMap
  selectedDayId: number | null
  tripMembers: TripMember[]
  locale: string
  timeFormat: string
  t: TFunction
  onSetParticipants: PlaceInspectorProps['onSetParticipants']
}

function PlaceReservationParticipants({ selectedAssignmentId, reservations, assignments, selectedDayId,
  tripMembers, locale, timeFormat, t, onSetParticipants }: PlaceReservationParticipantsProps) {
  return (
    <>
          {(() => {
            const res = selectedAssignmentId ? reservations.find(r => r.assignment_id === selectedAssignmentId) : null
            const assignment = selectedAssignmentId ? (assignments[String(selectedDayId)] || []).find(a => a.id === selectedAssignmentId) : null
            const currentParticipants = assignment?.participants || []
            const participantIds = currentParticipants.map(p => p.user_id)
            const allJoined = currentParticipants.length === 0
            const showParticipants = selectedAssignmentId && tripMembers.length > 1
            if (!res && !showParticipants) return null
            return (
              <>
                {/* Reservation */}
                {res && (() => {
                  const confirmed = res.status === 'confirmed'
                  return (
                    <div className={`mb-2 break-inside-avoid overflow-hidden rounded-xl border bg-surface-hover ${confirmed ? 'border-[rgba(22,163,74,0.2)]' : 'border-[rgba(217,119,6,0.2)]'}`}>
                      <div className={`flex items-center gap-2 px-2.5 py-1.5 ${confirmed ? 'bg-[rgba(22,163,74,0.08)]' : 'bg-[rgba(217,119,6,0.08)]'}`}>
                        <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${confirmed ? 'bg-[#16a34a]' : 'bg-[#d97706]'}`} />
                        <span className={`text-[10px] font-bold ${confirmed ? 'text-[#16a34a]' : 'text-[#d97706]'}`}>{confirmed ? t('reservations.confirmed') : t('reservations.pending')}</span>
                        <span className="flex-1" />
                        <span className="truncate text-[11px] font-semibold text-content">{res.title}</span>
                      </div>
                      <div className="flex flex-wrap gap-3 px-2.5 py-1.5">
                        {(() => {
                          const { date, time: startTime } = splitReservationDateTime(res.reservation_time)
                          const { time: endTime } = splitReservationDateTime(res.reservation_end_time)
                          return (
                            <>
                              {date && (
                                <div>
                                  <div className="text-[8px] font-semibold uppercase text-content-faint">{t('reservations.date')}</div>
                                  <div className="mt-px text-[10px] font-medium text-content">{new Date(date + 'T00:00:00Z').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</div>
                                </div>
                              )}
                              {(startTime || endTime) && (
                                <div>
                                  <div className="text-[8px] font-semibold uppercase text-content-faint">{t('reservations.time')}</div>
                                  <div className="mt-px text-[10px] font-medium text-content">
                                    {startTime ? formatTime(startTime, locale, timeFormat) : ''}
                                    {endTime ? ` – ${formatTime(endTime, locale, timeFormat)}` : ''}
                                  </div>
                                </div>
                              )}
                            </>
                          )
                        })()}
                        {res.confirmation_number && (
                          <div>
                            <div className="text-[8px] font-semibold uppercase text-content-faint">{t('reservations.confirmationCode')}</div>
                            <div className="mt-px text-[10px] font-medium text-content">{res.confirmation_number}</div>
                          </div>
                        )}
                      </div>
                      {res.notes && <div className="collab-note-md px-2.5 pb-1.5 text-[10px] leading-[1.4] text-content-faint [overflow-wrap:anywhere] [word-break:break-word]"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{res.notes}</Markdown></div>}
                      {(() => {
                        const meta = typeof res.metadata === 'string' ? JSON.parse(res.metadata || '{}') : (res.metadata || {})
                        if (!meta || Object.keys(meta).length === 0) return null
                        const parts: string[] = []
                        if (meta.airline && meta.flight_number) parts.push(`${meta.airline} ${meta.flight_number}`)
                        else if (meta.flight_number) parts.push(meta.flight_number)
                        if (meta.departure_airport && meta.arrival_airport) parts.push(`${meta.departure_airport} → ${meta.arrival_airport}`)
                        if (meta.train_number) parts.push(meta.train_number)
                        if (meta.platform) parts.push(`Gl. ${meta.platform}`)
                        if (meta.check_in_time) parts.push(`Check-in ${meta.check_in_time}`)
                        if (meta.check_out_time) parts.push(`Check-out ${meta.check_out_time}`)
                        if (parts.length === 0) return null
                        return <div className="px-2.5 pb-1.5 text-[10px] font-medium text-content-muted">{parts.join(' · ')}</div>
                      })()}
                    </div>
                  )
                })()}

                {/* Participants */}
                {showParticipants && (
                  <ParticipantsBox
                    tripMembers={tripMembers}
                    participantIds={participantIds}
                    allJoined={allJoined}
                    onSetParticipants={onSetParticipants}
                    selectedAssignmentId={selectedAssignmentId}
                    selectedDayId={selectedDayId}
                    t={t}
                  />
                )}
              </>
            )
          })()}
    </>
  )
}

interface RouteTrackStats {
  distanceMeters: number
  hasElevation: boolean
  minElevation: number
  maxElevation: number
  totalUp: number
  totalDown: number
  chartWidth: number
  chartHeight: number
  elevationPath: string
}

function routeTrackStatsFromGeometry(routeGeometry?: string | null): RouteTrackStats | null {
  if (!routeGeometry) return null
  try {
    const points = JSON.parse(routeGeometry) as number[][]
    if (!Array.isArray(points) || points.length < 2 || points.some(point => !Array.isArray(point) || point.length < 2)) return null

    const toRad = (degrees: number) => degrees * Math.PI / 180
    let distanceMeters = 0
    for (let i = 1; i < points.length; i++) {
      const [lat1, lng1] = points[i - 1]
      const [lat2, lng2] = points[i]
      if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
      const dLat = toRad(lat2 - lat1)
      const dLng = toRad(lng2 - lng1)
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
      distanceMeters += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }

    const hasElevation = points[0].length >= 3
    let minElevation = Infinity
    let maxElevation = -Infinity
    let totalUp = 0
    let totalDown = 0
    const elevations = hasElevation ? points.map(point => point[2]).filter(Number.isFinite) : []
    if (hasElevation && elevations.length !== points.length) return null

    for (let i = 0; i < elevations.length; i++) {
      const elevation = elevations[i]
      minElevation = Math.min(minElevation, elevation)
      maxElevation = Math.max(maxElevation, elevation)
      if (i > 0) {
        const diff = elevation - elevations[i - 1]
        if (diff > 0) totalUp += diff
        else totalDown += Math.abs(diff)
      }
    }

    const chartWidth = 280
    const chartHeight = 60
    let elevationPath = ''
    if (elevations.length > 1) {
      const step = Math.max(1, Math.floor(elevations.length / chartWidth))
      const sampled = elevations.filter((_, i) => i % step === 0)
      const eMin = Math.min(...sampled)
      const eMax = Math.max(...sampled)
      const range = eMax - eMin || 1
      elevationPath = sampled.map((elevation, i) => {
        const x = (i / (sampled.length - 1)) * chartWidth
        const y = chartHeight - ((elevation - eMin) / range) * (chartHeight - 4) - 2
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')
    }

    return {
      distanceMeters,
      hasElevation,
      minElevation,
      maxElevation,
      totalUp,
      totalDown,
      chartWidth,
      chartHeight,
      elevationPath,
    }
  } catch {
    return null
  }
}

function TrackStatsBlock({ place, t, distanceUnit }: { place: Place; t: TFunction; distanceUnit: DistanceUnit }) {
  const stats = routeTrackStatsFromGeometry(place.route_geometry)
  if (!stats) return null

  const distanceKm = stats.distanceMeters / 1000

  return (
    <InfoBlock className="flex flex-col gap-2">
      <InfoBlockHeader
        className="mb-0"
        icon={<TrendingUp size={13} className="text-content-faint" />}
        title={t('inspector.trackStats')}
      />
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-1 text-xs font-semibold text-content">
          <MapPin size={12} className="text-[#3b82f6]" />
          {formatDistance(distanceKm, distanceUnit)}
        </div>
        {stats.hasElevation && (
          <>
            <div className="flex items-center gap-1 text-xs font-semibold text-content">
              <Mountain size={12} className="text-[#22c55e]" />
              {formatElevation(stats.maxElevation, distanceUnit)}
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-content">
              <Mountain size={12} className="text-[#ef4444]" />
              {formatElevation(stats.minElevation, distanceUnit)}
            </div>
            <div className="text-xs text-content-muted">
              ↑{formatElevation(stats.totalUp, distanceUnit)} &nbsp;↓{formatElevation(stats.totalDown, distanceUnit)}
            </div>
          </>
        )}
      </div>
      {stats.elevationPath && (
        <svg width="100%" viewBox={`0 0 ${stats.chartWidth} ${stats.chartHeight}`} preserveAspectRatio="none" className="block rounded-md bg-surface-tertiary">
          <defs>
            <linearGradient id={`ele-grad-${place.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={`${stats.elevationPath} L${stats.chartWidth},${stats.chartHeight} L0,${stats.chartHeight} Z`} fill={`url(#ele-grad-${place.id})`} />
          <path d={stats.elevationPath} fill="none" stroke="#3b82f6" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </InfoBlock>
  )
}

interface PlaceExtrasProps {
  openingHours: string[] | null
  weekdayIndex: number
  hoursExpanded: boolean
  setHoursExpanded: React.Dispatch<React.SetStateAction<boolean>>
  timeFormat: string
  t: TFunction
  place: Place
  placeFiles: TripFile[]
  onFileUpload?: PlaceInspectorProps['onFileUpload']
  filesExpanded: boolean
  setFilesExpanded: React.Dispatch<React.SetStateAction<boolean>>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  isUploading: boolean
  distanceUnit: DistanceUnit
}

function PlaceExtras({ openingHours, weekdayIndex, hoursExpanded, setHoursExpanded, timeFormat, t, place,
  placeFiles, onFileUpload, filesExpanded, setFilesExpanded, fileInputRef, handleFileUpload, isUploading, distanceUnit }: PlaceExtrasProps) {
  return (
          <>
          {openingHours && openingHours.length > 0 && (
            <div className={INFO_BLOCK_FLUSH_CLASS}>
              <button
                onClick={() => setHoursExpanded(h => !h)}
                className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent px-3 py-2 font-[inherit]"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <Clock size={13} className="shrink-0 text-content-faint" />
                  <span className="truncate text-xs font-medium text-content-secondary">
                    {hoursExpanded ? t('inspector.openingHours') : (convertHoursLine(openingHours[weekdayIndex] || '', timeFormat) || t('inspector.showHours'))}
                  </span>
                </div>
                {hoursExpanded ? <ChevronUp size={13} className="shrink-0 text-content-faint" /> : <ChevronDown size={13} className="shrink-0 text-content-faint" />}
              </button>
              {hoursExpanded && (
                <div className="px-3 pb-2.5">
                  {openingHours.map((line, i) => (
                    <div key={i} className={`${i === weekdayIndex ? 'font-semibold text-content' : 'font-normal text-content-muted'} py-0.5 text-xs`}>{convertHoursLine(line, timeFormat)}</div>
                  ))}
                </div>
              )}
            </div>
          )}


          <TrackStatsBlock place={place} t={t} distanceUnit={distanceUnit} />

          {/* Files section */}
          {(placeFiles.length > 0 || onFileUpload) && (
            <div className={INFO_BLOCK_FLUSH_CLASS}>
              <div className="flex items-center gap-1.5 px-3 py-2">
                <button
                  onClick={() => setFilesExpanded(f => !f)}
                  className="flex flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left font-[inherit]"
                >
                  <FileText size={13} className="shrink-0 text-content-faint" />
                  <span className="text-xs font-medium text-content-secondary">
                    {placeFiles.length > 0 ? t('inspector.filesCount', { count: placeFiles.length }) : t('inspector.files')}
                  </span>
                  {filesExpanded ? <ChevronUp size={12} className="text-content-faint" /> : <ChevronDown size={12} className="text-content-faint" />}
                </button>
                {onFileUpload && (
                  <label className="flex cursor-pointer items-center gap-1 rounded-md bg-surface-tertiary px-1.5 py-0.5 text-[11px] text-content-muted">
                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileUpload} />
                    {isUploading ? (
                      <span className="text-[11px]">…</span>
                    ) : (
                      <><Upload size={11} strokeWidth={2} /> {t('common.upload')}</>
                    )}
                  </label>
                )}
              </div>
              {filesExpanded && placeFiles.length > 0 && (
                <div className="flex flex-col gap-1 px-3 pb-2.5">
                  {placeFiles.map(f => (
                    <button key={f.id} onClick={() => openFile(f.url).catch(() => {})} className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent text-left no-underline">
                      {(f.mime_type || '').startsWith('image/') ? <FileImage size={12} className="text-content-muted" /> : <File size={12} className="text-content-muted" />}
                      <span className="flex-1 truncate text-xs text-content-secondary">{f.original_name}</span>
                      {f.file_size && <span className="shrink-0 text-[11px] text-content-faint">{formatFileSize(f.file_size)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          </>
  )
}
