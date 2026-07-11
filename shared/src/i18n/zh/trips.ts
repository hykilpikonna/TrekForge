import type { TranslationStrings } from '../types';

const trips: TranslationStrings = {
  'trips.memberRemoved': '{username} 已移除',
  'trips.memberRemoveError': '移除失败',
  'trips.memberAdded': '{username} 已添加',
  'trips.memberAddError': '添加失败',
  'trips.reminder': '提醒',
  'trips.reminderNone': '无',
  'trips.reminderDay': '天',
  'trips.reminderDays': '天',
  'trips.reminderCustom': '自定义',
  'trips.reminderDaysBefore': '天前提醒',
  'trips.reminderDisabledHint': '旅行提醒已禁用。请在管理 > 设置 > 通知中启用。',
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
