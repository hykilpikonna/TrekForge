import type { TranslationStrings } from '../types';

const trips: TranslationStrings = {
  'trips.reminder': 'Recordatori',
  'trips.reminderNone': 'Cap',
  'trips.reminderDay': 'dia',
  'trips.reminderDays': 'dies',
  'trips.reminderCustom': 'Personalitzat',
  'trips.memberRemoved': '{username} eliminat',
  'trips.memberRemoveError': 'Error en eliminar',
  'trips.memberAdded': '{username} afegit',
  'trips.memberAddError': 'Error en afegir',
  'trips.reminderDaysBefore': 'dies abans de la sortida',
  'trips.reminderDisabledHint':
    "Els recordatoris de viatge estan desactivats. Activa'ls a Admin > Configuració > Notificacions.",
  'trips.scheduleMargin': 'Marge de planificació',
  'trips.scheduleMarginHint': 'Marge afegit després de cada lloc i tram de ruta programat.',
  'trips.scheduleMarginInvalid': 'Introdueix un marge com ara 0m, 15m o 1h',
  'trips.routingProvider': 'Temps de conducció estimat',
  'trips.routingProviderOsrm': 'OSRM',
  'trips.routingProviderGoogle': 'Google Maps',
  'trips.routingProviderGoogleMobile': 'Google Maps (Mòbil)',
  'trips.routingProviderHint': 'Tria el proveïdor utilitzat per a les estimacions de temps de conducció entre llocs programats.',
  'trips.routingOptimism': 'Optimisme',
  'trips.routingOptimismHint': "0 utilitza l'estimació de trànsit més lenta de Google Maps, 1 utilitza la més ràpida i 0.33 és prudent.",
  'trips.routingPessimistic': 'Pessimista',
  'trips.routingOptimistic': 'Optimista',
  'trips.routingAvoid': 'Evitar',
  'trips.routingAvoidTolls': 'Peatges',
  'trips.routingAvoidHighways': 'Autopistes',
  'trips.routingAvoidFerries': 'Ferris',
};
export default trips;
