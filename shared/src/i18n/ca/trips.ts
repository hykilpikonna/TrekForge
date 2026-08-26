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
  'trips.scheduleMargin': 'Schedule margin',
  'trips.scheduleMarginHint': 'Buffer added after each scheduled place and route segment.',
  'trips.scheduleMarginInvalid': 'Enter a margin like 0m, 15m, or 1h',
  'trips.routingProvider': 'Estimated Driving Time',
  'trips.routingProviderOsrm': 'OSRM',
  'trips.routingProviderGoogle': 'Google Maps',
  'trips.routingProviderGoogleMobile': 'Google Maps (Mobile)',
  'trips.routingProviderHint': 'Choose the provider used for driving-time estimates between scheduled places.',
  'trips.routingOptimism': 'Optimism',
  'trips.routingOptimismHint': "0 uses Google Maps' slowest traffic estimate, 1 uses the fastest, and 0.33 leans cautious.",
  'trips.routingPessimistic': 'Pessimistic',
  'trips.routingOptimistic': 'Optimistic',
  'trips.routingAvoid': 'Avoid',
  'trips.routingAvoidTolls': 'Tolls',
  'trips.routingAvoidHighways': 'Highways',
  'trips.routingAvoidFerries': 'Ferries',

};
export default trips;
