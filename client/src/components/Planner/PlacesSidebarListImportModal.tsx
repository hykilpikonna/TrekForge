import { useState, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { RefreshCw } from 'lucide-react'
import ToggleSwitch from '../Settings/ToggleSwitch'
import { placesApi } from '../../api/client'
import type { SidebarState } from './usePlacesSidebar'

export function ListImportModal(S: SidebarState) {
  const {
    setListImportOpen, setListImportUrl, t, hasMultipleListImportProviders, availableListImportProviders,
    listImportProvider, setListImportProvider, listImportUrl, listImportLoading, handleListImport,
    listImportEnrich, setListImportEnrich, canEnrichImport,
    categories, listImportCategoryMode, setListImportCategoryMode,
    listImportCategoryId, setListImportCategoryId,
  } = S
  const importDisabled = !listImportUrl.trim() || listImportLoading || (listImportCategoryMode === 'existing' && !listImportCategoryId)
  return ReactDOM.createPortal(
    <div
      onClick={() => { setListImportOpen(false); setListImportUrl('') }}
      className="bg-[rgba(0,0,0,0.4)]"
      style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface-card"
        style={{ borderRadius: 16, width: '100%', maxWidth: 440, padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
      >
        <div className="text-content" style={{ fontSize: 'calc(15px * var(--fs-scale-subtitle, 1))', fontWeight: 700, marginBottom: 4 }}>
          {t('places.importList')}
        </div>
        {hasMultipleListImportProviders && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {availableListImportProviders.map(provider => (
              <button
                key={provider}
                onClick={() => setListImportProvider(provider)}
                className={listImportProvider === provider ? 'bg-accent text-accent-text' : 'bg-surface-tertiary text-content-muted'}
                style={{
                  padding: '6px 10px', borderRadius: 20, border: 'none', cursor: 'pointer',
                  fontSize: 'calc(11px * var(--fs-scale-caption, 1))', fontWeight: 600, fontFamily: 'inherit',
                }}
              >
                {provider === 'google' ? t('places.importGoogleList') : t('places.importNaverList')}
              </button>
            ))}
          </div>
        )}
        <div className="text-content-faint" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', marginBottom: 16 }}>
          {t(listImportProvider === 'google' ? 'places.googleListHint' : 'places.naverListHint')}
        </div>
        <input
          type="text"
          value={listImportUrl}
          onChange={e => setListImportUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !listImportLoading) handleListImport() }}
          placeholder={listImportProvider === 'google' ? 'https://maps.app.goo.gl/...' : 'https://naver.me/...'}
          autoFocus
          className="bg-surface-tertiary text-content"
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 10,
            border: '1px solid var(--border-primary)',
            fontSize: 'calc(13px * var(--fs-scale-body, 1))', outline: 'none',
            fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        <div style={{ marginTop: 12 }}>
          <label className="text-content" style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            {t('places.formCategory')}
          </label>
          <select
            value={listImportCategoryMode}
            onChange={e => setListImportCategoryMode(e.target.value as 'none' | 'existing' | 'list')}
            className="bg-surface-tertiary text-content"
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 10,
              border: '1px solid var(--border-primary)', fontSize: 13,
              outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          >
            <option value="none">{t('places.noCategory')}</option>
            {categories.length > 0 && <option value="existing">Specific category</option>}
            <option value="list">New category from list title</option>
          </select>
          {listImportCategoryMode === 'existing' && (
            <select
              value={listImportCategoryId}
              onChange={e => setListImportCategoryId(e.target.value)}
              className="bg-surface-tertiary text-content"
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 10,
                border: '1px solid var(--border-primary)', fontSize: 13,
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginTop: 8,
              }}
            >
              <option value="">{t('places.formCategory')}</option>
              {categories.map(category => (
                <option key={category.id} value={String(category.id)}>{category.name}</option>
              ))}
            </select>
          )}
        </div>
        {canEnrichImport && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="text-content" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', fontWeight: 600 }}>{t('places.enrichOnImport')}</div>
              <div className="text-content-faint" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', marginTop: 2 }}>{t('places.enrichOnImportHint')}</div>
            </div>
            <ToggleSwitch on={listImportEnrich} onToggle={() => setListImportEnrich(!listImportEnrich)} />
          </div>
        )}
        <ImportedListsSection S={S} />
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button
            onClick={() => { setListImportOpen(false); setListImportUrl('') }}
            className="text-content"
            style={{
              padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border-primary)',
              background: 'none', fontSize: 'calc(13px * var(--fs-scale-body, 1))', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleListImport}
            disabled={importDisabled}
            className={importDisabled ? 'bg-surface-tertiary text-content-faint' : 'bg-accent text-accent-text'}
            style={{
              padding: '8px 16px', borderRadius: 10, border: 'none',
              fontSize: 'calc(13px * var(--fs-scale-body, 1))', fontWeight: 500, cursor: importDisabled ? 'default' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {listImportLoading ? t('common.loading') : t('common.import')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

interface ImportedListRow {
  id: number
  provider: 'google' | 'naver'
  list_url: string
  list_name: string | null
  last_imported_at: string
}

/** Previously imported shared lists for this trip. Refresh re-fetches the list;
 *  existing-place dedup on the server skips everything already imported, so only
 *  new entries land. */
function ImportedListsSection({ S }: { S: SidebarState }) {
  const { tripId, t, refreshingListIds, handleRefreshImportedList } = S
  const [lists, setLists] = useState<ImportedListRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    placesApi.listImportedLists(tripId)
      .then((r: { lists: ImportedListRow[] }) => { if (!cancelled) setLists(r.lists) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tripId])

  if (loading || lists.length === 0) return null

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border-primary)', paddingTop: 10 }}>
      <div className="text-content-faint" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', fontWeight: 600, marginBottom: 6 }}>
        {t('places.importedLists')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {lists.map(list => {
          const refreshing = refreshingListIds.has(list.id)
          return (
            <div key={list.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="text-content" style={{ fontSize: 'calc(13px * var(--fs-scale-body, 1))', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {list.list_name || list.list_url}
                </div>
                <div className="text-content-faint" style={{ fontSize: 'calc(11px * var(--fs-scale-body, 1))' }}>
                  {list.provider === 'google' ? 'Google Maps' : 'Naver Maps'}
                </div>
              </div>
              <button
                onClick={() => handleRefreshImportedList(list.id, list.provider, list.list_name)}
                disabled={refreshing}
                className={refreshing ? 'text-content-faint' : 'bg-accent text-accent-text'}
                title={t('places.refreshList')}
                aria-label={t('places.refreshList')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '5px 10px', borderRadius: 8, border: 'none',
                  fontSize: 'calc(12px * var(--fs-scale-body, 1))', fontWeight: 500,
                  cursor: refreshing ? 'default' : 'pointer', fontFamily: 'inherit',
                }}
              >
                <RefreshCw size={12} strokeWidth={2} className={refreshing ? 'animate-spin' : undefined} />
                {refreshing ? t('common.loading') : t('places.refreshList')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
