import type { Place } from '../../types'

type MapPlacePhoto = Pick<Place, 'id' | 'name' | 'image_url' | 'google_place_id' | 'google_ftid' | 'osm_id' | 'lat' | 'lng'>

export function placePhotoCoordinateKey(place: MapPlacePhoto): string | null {
  return place.lat != null && place.lng != null ? `${place.lat},${place.lng}` : null
}

export function placePhotoCacheKey(place: MapPlacePhoto): string | null {
  return place.google_place_id || place.google_ftid || place.osm_id || placePhotoCoordinateKey(place)
}

export function placePhotoFetchId(place: MapPlacePhoto): string | null {
  return (place.image_url?.startsWith('/api/maps/place-photo/') ? place.image_url : null)
    || place.google_place_id
    || place.google_ftid
    || place.osm_id
    || place.image_url
    || null
}

export function placesPhotoInputsKey(places: MapPlacePhoto[]): string {
  return places.map(place => [
    place.id,
    place.google_place_id || '',
    place.google_ftid || '',
    place.osm_id || '',
    place.image_url || '',
    place.name || '',
    place.lat ?? '',
    place.lng ?? '',
  ].join(':')).join('|')
}
