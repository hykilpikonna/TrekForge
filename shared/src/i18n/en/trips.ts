import type { TranslationStrings } from '../types';

const trips: TranslationStrings = {
  'trips.memberRemoved': '{username} removed',
  'trips.memberRemoveError': 'Failed to remove',
  'trips.memberAdded': '{username} added',
  'trips.memberAddError': 'Failed to add',
  'trips.reminder': 'Reminder',
  'trips.reminderNone': 'None',
  'trips.reminderDay': 'day',
  'trips.reminderDays': 'days',
  'trips.reminderCustom': 'Custom',
  'trips.reminderDaysBefore': 'days before departure',
  'trips.reminderDisabledHint': 'Trip reminders are disabled. Enable them in Admin > Settings > Notifications.',
  'trips.scheduleMargin': 'Schedule margin',
  'trips.scheduleMarginHint': 'Buffer added after each scheduled place and route segment.',
  'trips.scheduleMarginInvalid': 'Enter a margin like 0m, 15m, or 1h',
};
export default trips;
