import type { TranslationStrings } from '../types';

const trips: TranslationStrings = {
  'trips.memberRemoved': '{username} đã bị xóa',
  'trips.memberRemoveError': 'Không thể xóa',
  'trips.memberAdded': '{username} đã thêm',
  'trips.memberAddError': 'Không thể thêm',
  'trips.reminder': 'Lời nhắc nhở',
  'trips.reminderNone': 'Không có',
  'trips.reminderDay': 'ngày',
  'trips.reminderDays': 'ngày',
  'trips.reminderCustom': 'Tùy chọn',
  'trips.reminderDaysBefore': 'ngày trước khi khởi hành',
  'trips.reminderDisabledHint': 'Lời nhắc chuyến đi bị tắt. Kích hoạt chúng trong Quản trị > Cài đặt > Thông báo.',
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
