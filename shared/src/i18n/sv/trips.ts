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
  'trips.scheduleMargin': 'Schemamarginal',
  'trips.scheduleMarginHint': 'Buffert som läggs till efter varje schemalagd plats och ruttsträcka.',
  'trips.scheduleMarginInvalid': 'Ange en marginal som 0m, 15m eller 1h',
  'trips.routingProvider': 'Beräknad körtid',
  'trips.routingProviderOsrm': 'OSRM',
  'trips.routingProviderGoogle': 'Google Maps',
  'trips.routingProviderGoogleMobile': 'Google Maps (Mobil)',
  'trips.routingProviderHint': 'Välj leverantör för beräkning av körtid mellan schemalagda platser.',
  'trips.routingOptimism': 'Optimism',
  'trips.routingOptimismHint': '0 använder Google Maps långsammaste trafikberäkning, 1 använder den snabbaste och 0.33 lutar mot försiktig.',
  'trips.routingPessimistic': 'Pessimistisk',
  'trips.routingOptimistic': 'Optimistisk',
  'trips.routingAvoid': 'Undvik',
  'trips.routingAvoidTolls': 'Vägtullar',
  'trips.routingAvoidHighways': 'Motorvägar',
  'trips.routingAvoidFerries': 'Färjor',
};
export default trips;
