import type { TranslationStrings } from '../types';

const trips: TranslationStrings = {
  'trips.memberRemoved': '{username} تمت إزالته',
  'trips.memberRemoveError': 'فشل في الإزالة',
  'trips.memberAdded': '{username} تمت إضافته',
  'trips.memberAddError': 'فشل في الإضافة',
  'trips.reminder': 'تذكير',
  'trips.reminderNone': 'بدون',
  'trips.reminderDay': 'يوم',
  'trips.reminderDays': 'أيام',
  'trips.reminderCustom': 'مخصص',
  'trips.reminderDaysBefore': 'أيام قبل المغادرة',
  'trips.reminderDisabledHint': 'تذكيرات الرحلة معطلة. قم بتفعيلها من الإدارة > الإعدادات > الإشعارات.',
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
