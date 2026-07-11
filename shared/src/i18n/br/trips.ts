import type { TranslationStrings } from '../types';

const trips: TranslationStrings = {
  'trips.reminder': 'Lembrete',
  'trips.reminderNone': 'Nenhum',
  'trips.reminderDay': 'dia',
  'trips.reminderDays': 'dias',
  'trips.reminderCustom': 'Personalizado',
  'trips.memberRemoved': '{username} removido',
  'trips.memberRemoveError': 'Falha ao remover',
  'trips.memberAdded': '{username} adicionado',
  'trips.memberAddError': 'Falha ao adicionar',
  'trips.reminderDaysBefore': 'dias antes da partida',
  'trips.reminderDisabledHint':
    'Os lembretes de viagem estão desativados. Ative-os em Admin > Configurações > Notificações.',
  'trips.scheduleMargin': 'Schedule margin', // en-fallback
  'trips.scheduleMarginHint': 'Buffer added after each scheduled place and route segment.', // en-fallback
  'trips.scheduleMarginInvalid': 'Enter a margin like 0m, 15m, or 1h', // en-fallback
  'trips.routingProvider': 'Estimated Driving Time', // en-fallback
  'trips.routingProviderOsrm': 'OSRM', // en-fallback
  'trips.routingProviderGoogle': 'Google Maps', // en-fallback
  'trips.routingProviderHint': 'Choose the provider used for driving-time estimates between scheduled places.', // en-fallback
  'trips.routingOptimism': 'Optimism', // en-fallback
  'trips.routingOptimismHint': "0 uses Google Maps' slowest traffic estimate, 1 uses the fastest, and 0.33 leans cautious.", // en-fallback
  'trips.routingPessimistic': 'Pessimistic', // en-fallback
  'trips.routingOptimistic': 'Optimistic', // en-fallback
  'trips.routingAvoid': 'Avoid', // en-fallback
  'trips.routingAvoidTolls': 'Tolls', // en-fallback
  'trips.routingAvoidHighways': 'Highways', // en-fallback
  'trips.routingAvoidFerries': 'Ferries', // en-fallback
  'trips.routingProviderGoogleMobile': 'Google Maps (Mobile)', // en-fallback
};
export default trips;
