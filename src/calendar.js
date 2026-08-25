/**
 * Month-safe date maths, shared by everything that has to reason in calendar
 * months rather than in fixed-length stretches of days.
 *
 * Static because there is nothing to hold: the same date in, the same date out.
 */
export class Calendar {
  /** How many days the month containing `date` has: 28, 29, 30 or 31. */
  static daysInMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  /** 31 March minus 1 month is 28/29 February, not 3 March. */
  static subtractMonths(date, months) {
    const dayOfMonth = date.getDate();
    const shifted = new Date(date.getTime());
    shifted.setDate(1);
    shifted.setMonth(shifted.getMonth() - months);
    shifted.setDate(Math.min(dayOfMonth, Calendar.daysInMonth(shifted)));
    return shifted;
  }
}
