import type { TranslationStrings } from '../types';

const trips: TranslationStrings = {
  'trips.memberRemoved': '{username} borttagen',
  'trips.memberRemoveError': 'Det gick inte att ta bort',
  'trips.memberAdded': '{username} tillagd',
  'trips.memberAddError': 'Det gick inte att lägga till',
  'trips.reminder': 'Påminnelse',
  'trips.reminderNone': 'Ingen',
  'trips.reminderDay': 'dag',
  'trips.reminderDays': 'dagar',
  'trips.reminderCustom': 'Anpassad',
  'trips.reminderDaysBefore': 'dagar innan avresa',
  'trips.reminderDisabledHint':
    'Resepåminnelser är inaktiverade. Aktivera dem under Admin > Inställningar > Meddelanden.',
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
