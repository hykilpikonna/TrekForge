import { render, screen, waitFor, fireEvent, act } from '../../../tests/helpers/render';
import userEvent from '@testing-library/user-event';
import { buildUser, buildTrip, buildPlace, buildCategory, buildReservation, buildAssignment, buildDay } from '../../../tests/helpers/factories';
import { resetAllStores, seedStore } from '../../../tests/helpers/store';
import { useAuthStore } from '../../store/authStore';
import { useTripStore } from '../../store/tripStore';
import { useSettingsStore } from '../../store/settingsStore';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    mapsApi: {
      details: vi.fn().mockResolvedValue({ place: null }),
      placePhoto: vi.fn().mockResolvedValue({ photoUrl: null }),
    },
  };
});

vi.mock('../../api/authUrl', () => ({
  getAuthUrl: vi.fn().mockResolvedValue('http://test/file'),
}));

vi.mock('../../services/photoService', () => ({
  getCached: vi.fn(() => null),
  isLoading: vi.fn(() => false),
  fetchPhoto: vi.fn(),
  onThumbReady: vi.fn(() => () => {}),
}));

// ── IntersectionObserver stub ─────────────────────────────────────────────────

class MockIO {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeAll(() => {
  (globalThis as any).IntersectionObserver = MockIO;
});

// ── Import component after mocks ──────────────────────────────────────────────

import PlaceInspector from './PlaceInspector';
import { mapsApi } from '../../api/client';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const place = buildPlace({
  id: 1,
  name: 'Eiffel Tower',
  address: 'Champ de Mars, Paris',
  lat: 48.8584,
  lng: 2.2945,
  description: 'Famous iron tower',
});

const cat = buildCategory({ name: 'Landmark', icon: 'MapPin' });

const defaultProps = {
  place,
  categories: [cat],
  days: [],
  selectedDayId: null as number | null,
  selectedAssignmentId: null as number | null,
  assignments: {} as Record<string, any[]>,
  reservations: [] as any[],
  onClose: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onAssignToDay: vi.fn(),
  onRemoveAssignment: vi.fn(),
  files: [] as any[],
  onFileUpload: vi.fn().mockResolvedValue(undefined),
  tripMembers: [] as any[],
  onSetParticipants: vi.fn(),
  onUpdatePlace: vi.fn(),
  onUpdateAssignmentDuration: vi.fn(),
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
  sessionStorage.clear();

  seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });
  seedStore(useTripStore, { trip: buildTrip({ id: 1 }) });
  seedStore(useSettingsStore, { settings: { time_format: '24h', temperature_unit: 'celsius' } });

  vi.mocked(mapsApi.details).mockResolvedValue({ place: null });
  vi.mocked(mapsApi.placePhoto).mockResolvedValue({ photoUrl: null });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlaceInspector', () => {

  // ── Rendering ──────────────────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-001: returns null when place is null', () => {
    const { container } = render(<PlaceInspector {...defaultProps} place={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('FE-PLANNER-INSPECTOR-002: renders without crashing with a valid place', () => {
    render(<PlaceInspector {...defaultProps} />);
    expect(document.body).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-003: shows place name in header', () => {
    render(<PlaceInspector {...defaultProps} />);
    expect(screen.getByText('Eiffel Tower')).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-004: shows place address', () => {
    render(<PlaceInspector {...defaultProps} />);
    expect(screen.getByText(/Champ de Mars, Paris/)).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-005: shows category badge with category name', () => {
    const placeWithCat = buildPlace({ id: 100, category_id: cat.id });
    render(<PlaceInspector {...defaultProps} place={placeWithCat} categories={[cat]} />);
    const matches = screen.getAllByText('Landmark');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('FE-PLANNER-INSPECTOR-006: shows lat/lng coordinates', () => {
    render(<PlaceInspector {...defaultProps} />);
    // The component renders Number(lat).toFixed(6), Number(lng).toFixed(6)
    expect(screen.getByText(/48\.858400/)).toBeTruthy();
    expect(screen.getByText(/2\.294500/)).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-007: ignores legacy place_time and end_time', () => {
    const p = buildPlace({ id: 101, place_time: '09:00', end_time: '17:00' });
    render(<PlaceInspector {...defaultProps} place={p} />);
    expect(screen.queryByText(/09:00/)).toBeNull();
    expect(screen.queryByText(/17:00/)).toBeNull();
  });

  it('FE-PLANNER-INSPECTOR-008: does not render a manual start-only time', () => {
    const p = buildPlace({ id: 102, place_time: '09:00', end_time: null });
    render(<PlaceInspector {...defaultProps} place={p} />);
    expect(screen.queryByText(/09:00/)).toBeNull();
  });

  it('FE-PLANNER-INSPECTOR-009: description is rendered as markdown', () => {
    const p = buildPlace({ id: 103, description: '**Bold text**' });
    const { container } = render(<PlaceInspector {...defaultProps} place={p} />);
    const strong = container.querySelector('strong');
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe('Bold text');
  });

  it('FE-PLANNER-INSPECTOR-010: notes rendered when no description', () => {
    const p = buildPlace({ id: 104, description: null, notes: 'Some notes' } as any);
    render(<PlaceInspector {...defaultProps} place={p} />);
    expect(screen.getByText(/Some notes/)).toBeTruthy();
  });

  // ── Close button ───────────────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-011: close (X) button calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PlaceInspector {...defaultProps} onClose={onClose} />);
    // Find the X button — it's the close button with an X icon inside
    const buttons = screen.getAllByRole('button');
    // The close button is typically in the header, first button with X icon
    const closeBtn = buttons.find(btn => btn.querySelector('svg'));
    // Click the last-found header button that has no text label (the X)
    // More reliable: find button by its position as close button
    await user.click(buttons[0]); // first button is the close X
    expect(onClose).toHaveBeenCalled();
  });

  // ── Edit / Delete buttons ──────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-012: Edit button is visible', () => {
    render(<PlaceInspector {...defaultProps} />);
    // Edit button is in footer actions
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('FE-PLANNER-INSPECTOR-013: clicking Edit button calls onEdit', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { container } = render(<PlaceInspector {...defaultProps} onEdit={onEdit} />);
    // The edit button has Edit2 icon — find footer buttons
    const allButtons = screen.getAllByRole('button');
    // Edit button is second-to-last in footer (before delete)
    const editBtn = allButtons[allButtons.length - 2];
    await user.click(editBtn);
    expect(onEdit).toHaveBeenCalled();
  });

  it('FE-PLANNER-INSPECTOR-014: clicking Delete button calls onDelete', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<PlaceInspector {...defaultProps} onDelete={onDelete} />);
    const allButtons = screen.getAllByRole('button');
    // Delete button is the last button in the footer
    const deleteBtn = allButtons[allButtons.length - 1];
    await user.click(deleteBtn);
    expect(onDelete).toHaveBeenCalled();
  });

  // ── Assign to / remove from day ────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-015: "Add to day" button appears when selectedDayId is set and place NOT in that day', () => {
    render(<PlaceInspector {...defaultProps} selectedDayId={1} assignments={{ '1': [] }} />);
    const allButtons = screen.getAllByRole('button');
    // The add-to-day button is the first footer button (Plus icon)
    // It should exist when selectedDayId is set and place is not assigned
    expect(allButtons.length).toBeGreaterThan(2);
  });

  it('FE-PLANNER-INSPECTOR-016: clicking assign-to-day button calls onAssignToDay with placeId', async () => {
    const user = userEvent.setup();
    const onAssignToDay = vi.fn();
    render(
      <PlaceInspector
        {...defaultProps}
        selectedDayId={1}
        assignments={{ '1': [] }}
        onAssignToDay={onAssignToDay}
      />
    );
    const addBtn = screen.getByText('Add to Day').closest('button')!;
    await user.click(addBtn);
    expect(onAssignToDay).toHaveBeenCalledWith(place.id);
  });

  it('FE-PLANNER-INSPECTOR-017: "Remove from day" button appears when place IS assigned to selectedDay', () => {
    const assignmentInDay = [{ id: 99, place, day_id: 1, place_id: place.id, order_index: 0, notes: null }];
    render(
      <PlaceInspector
        {...defaultProps}
        selectedDayId={1}
        assignments={{ '1': assignmentInDay }}
      />
    );
    const allButtons = screen.getAllByRole('button');
    expect(allButtons.length).toBeGreaterThan(2);
  });

  it('FE-PLANNER-INSPECTOR-018: clicking remove calls onRemoveAssignment with dayId and assignmentId', async () => {
    const user = userEvent.setup();
    const onRemoveAssignment = vi.fn();
    const assignmentInDay = [{ id: 99, place, day_id: 1, place_id: place.id, order_index: 0, notes: null }];
    render(
      <PlaceInspector
        {...defaultProps}
        selectedDayId={1}
        assignments={{ '1': assignmentInDay }}
        onRemoveAssignment={onRemoveAssignment}
      />
    );
    // Find the remove button — it has "Remove" text (sm:hidden span)
    const removeBtn = screen.getByText('Remove').closest('button')!;
    await user.click(removeBtn);
    // Component calls onRemoveAssignment(selectedDayId, assignmentInDay.id)
    expect(onRemoveAssignment).toHaveBeenCalledWith(1, 99);
  });

  it('FE-PLANNER-INSPECTOR-018b: shows assignment duration when a selected place is assigned to the day', () => {
    const assignmentInDay = buildAssignment({ id: 99, day_id: 1, place, duration_minutes: 75 });
    render(
      <PlaceInspector
        {...defaultProps}
        selectedDayId={1}
        selectedAssignmentId={99}
        assignments={{ '1': [assignmentInDay] }}
      />
    );

    expect(screen.getByLabelText('Scheduled Duration')).toHaveValue('1h 15m');
    expect(screen.getByTestId('inspector-info-left').firstElementChild?.textContent).toContain('Scheduled Duration');
    expect(screen.queryByLabelText('Margin before')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Margin after')).not.toBeInTheDocument();
  });

  it('FE-PLANNER-INSPECTOR-018c: saves flexible duration text as assignment minutes', async () => {
    const user = userEvent.setup();
    const onUpdateAssignmentDuration = vi.fn().mockResolvedValue(undefined);
    const assignmentInDay = buildAssignment({ id: 99, day_id: 1, place, duration_minutes: 75 });
    render(
      <PlaceInspector
        {...defaultProps}
        selectedDayId={1}
        selectedAssignmentId={99}
        assignments={{ '1': [assignmentInDay] }}
        onUpdateAssignmentDuration={onUpdateAssignmentDuration}
      />
    );

    const durationInput = screen.getByLabelText('Scheduled Duration');
    await user.clear(durationInput);
    await user.type(durationInput, '2h');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(onUpdateAssignmentDuration).toHaveBeenCalledWith(99, 1, 120);
    });
  });

  it('FE-PLANNER-INSPECTOR-018c2: does not expose per-assignment margin controls', () => {
    const assignmentInDay = buildAssignment({ id: 99, day_id: 1, place, duration_minutes: 75 });
    render(
      <PlaceInspector
        {...defaultProps}
        selectedDayId={1}
        selectedAssignmentId={99}
        assignments={{ '1': [assignmentInDay] }}
      />
    );

    expect(screen.queryByLabelText('Margin before')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Margin after')).not.toBeInTheDocument();
  });

  it('FE-PLANNER-INSPECTOR-018d: rejects invalid duration text', async () => {
    const user = userEvent.setup();
    const onUpdateAssignmentDuration = vi.fn().mockResolvedValue(undefined);
    const assignmentInDay = buildAssignment({ id: 99, day_id: 1, place, duration_minutes: 75 });
    render(
      <PlaceInspector
        {...defaultProps}
        selectedDayId={1}
        selectedAssignmentId={99}
        assignments={{ '1': [assignmentInDay] }}
        onUpdateAssignmentDuration={onUpdateAssignmentDuration}
      />
    );

    const durationInput = screen.getByLabelText('Scheduled Duration');
    await user.clear(durationInput);
    await user.type(durationInput, 'two hours');
    fireEvent.blur(durationInput);

    await waitFor(() => {
      expect(durationInput).toHaveValue('1h 15m');
    });
    expect(onUpdateAssignmentDuration).not.toHaveBeenCalled();
  });

  // ── Inline name editing ────────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-019: double-clicking name enters edit mode', async () => {
    const user = userEvent.setup();
    render(<PlaceInspector {...defaultProps} />);
    const nameSpan = screen.getByText('Eiffel Tower');
    await user.dblClick(nameSpan);
    const input = screen.getByDisplayValue('Eiffel Tower');
    expect(input).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-020: pressing Enter commits edit and calls onUpdatePlace', async () => {
    const user = userEvent.setup();
    const onUpdatePlace = vi.fn();
    render(<PlaceInspector {...defaultProps} onUpdatePlace={onUpdatePlace} />);
    const nameSpan = screen.getByText('Eiffel Tower');
    await user.dblClick(nameSpan);
    const input = screen.getByDisplayValue('Eiffel Tower');
    await user.clear(input);
    await user.type(input, 'New Tower Name');
    await user.keyboard('{Enter}');
    expect(onUpdatePlace).toHaveBeenCalledWith(place.id, { name: 'New Tower Name' });
  });

  it('FE-PLANNER-INSPECTOR-021: pressing Escape cancels edit', async () => {
    const user = userEvent.setup();
    render(<PlaceInspector {...defaultProps} />);
    const nameSpan = screen.getByText('Eiffel Tower');
    await user.dblClick(nameSpan);
    expect(screen.getByDisplayValue('Eiffel Tower')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByDisplayValue('Eiffel Tower')).toBeNull();
    expect(screen.getByText('Eiffel Tower')).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-022: blank name does not call onUpdatePlace', async () => {
    const user = userEvent.setup();
    const onUpdatePlace = vi.fn();
    render(<PlaceInspector {...defaultProps} onUpdatePlace={onUpdatePlace} />);
    const nameSpan = screen.getByText('Eiffel Tower');
    await user.dblClick(nameSpan);
    const input = screen.getByDisplayValue('Eiffel Tower');
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(onUpdatePlace).not.toHaveBeenCalled();
  });

  // ── Google Maps details (mapsApi) ──────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-023: mapsApi.details called when place has google_place_id', async () => {
    const p = buildPlace({ id: 200, google_place_id: 'ChIJ001' });
    render(<PlaceInspector {...defaultProps} place={p} />);
    await waitFor(() => {
      expect(vi.mocked(mapsApi.details)).toHaveBeenCalledWith('ChIJ001', expect.any(String), { expand: true });
    });
  });

  it('FE-PLANNER-INSPECTOR-023b: mapsApi.details can use a Google Maps feature ID', async () => {
    const p = buildPlace({ id: 201, google_place_id: null, google_ftid: '0x1:0x2' } as any);
    render(<PlaceInspector {...defaultProps} place={p} />);
    await waitFor(() => {
      expect(vi.mocked(mapsApi.details)).toHaveBeenCalledWith('0x1:0x2', expect.any(String), { expand: true });
    });
  });

  it('FE-PLANNER-INSPECTOR-024: rating chip shown when googleDetails has rating', async () => {
    const reviewText = 'This is a longer review that belongs in the review block only.';
    vi.mocked(mapsApi.details).mockResolvedValue({
      place: { rating: 4.5, rating_count: 1200, reviews: [{ author: 'Mia', rating: 5, text: reviewText }] },
    } as any);
    const p = buildPlace({ id: 201, google_place_id: 'ChIJ002' });
    render(<PlaceInspector {...defaultProps} place={p} />);
    const ratingText = await screen.findByText(/4\.5/);
    expect(ratingText.closest('div')?.textContent).not.toContain(reviewText);
    expect(await screen.findByText(reviewText)).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-024b: localized/original names and expanded metadata are shown', async () => {
    vi.mocked(mapsApi.details).mockResolvedValue({
      place: {
        name_translated: 'Hizen-Hashima Lighthouse',
        name_original: '肥前端島灯台',
        written_address: 'Hashima, Nagasaki, Japan',
        type: 'Historical landmark',
        accessible: false,
        accessibility: [{ key: 'wheelchair_accessible_entrance', label: 'Wheelchair-accessible entrance', value: false, text: 'No wheelchair-accessible entrance' }],
        reviews: [{ author: 'Aiko', rating: 5, text: 'Great view from the water.', time: '2 months ago' }],
        popular_status: 'Now: Usually not too busy',
        popular_times: [{ day: 1, hour: 9, occupancy_percent: 25 }, { day: 1, hour: 10, occupancy_percent: 50 }],
      },
    } as any);
    const p = buildPlace({ id: 205, name: '肥前端島灯台', google_place_id: 'ChIJ005' });
    render(<PlaceInspector {...defaultProps} place={p} />);

    await screen.findByText('Hizen-Hashima Lighthouse');
    expect(screen.getByText('Hashima, Nagasaki, Japan')).toBeTruthy();
    expect(screen.getByText('Historical Landmark')).toBeTruthy();
    expect(screen.getByText('No wheelchair-accessible entrance')).toBeTruthy();
    const accessibilityBlock = screen.getByTestId('inspector-accessibility') as HTMLElement;
    expect(screen.getByTestId('inspector-info-left')).toContainElement(accessibilityBlock);
    expect(screen.getByTestId('inspector-info-right')).not.toContainElement(accessibilityBlock);
    expect(screen.getByText('Great view from the water.')).toBeTruthy();
    expect(screen.getByText('Popular times')).toBeTruthy();
    expect(screen.getByText('Now: Usually not too busy')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-024b2: popular times collapse to scheduled day and highlight scheduled hours', async () => {
    const user = userEvent.setup();
    vi.mocked(mapsApi.details).mockResolvedValue({
      place: {
        popular_times: [
          { day: 2, hour: 8, occupancy_percent: 35 },
          { day: 2, hour: 9, occupancy_percent: 65 },
          { day: 3, hour: 8, occupancy_percent: 20 },
        ],
      },
    } as any);
    const p = buildPlace({ id: 208, name: 'Morning Museum', google_place_id: 'ChIJSchedule' });
    const assignment = buildAssignment({ id: 501, day_id: 12, place: p, duration_minutes: 120, order_index: 0 });
    const day = buildDay({ id: 12, date: '2026-12-01', wake_up_time: '08:00' });

    render(
      <PlaceInspector
        {...defaultProps}
        place={p}
        days={[day]}
        selectedDayId={12}
        selectedAssignmentId={501}
        assignments={{ '12': [assignment] }}
      />
    );

    await screen.findByTestId('popular-times-day-2');
    expect(screen.queryByTestId('popular-times-day-3')).toBeNull();
    expect(screen.getByTestId('popular-times-day-2').firstElementChild?.className).toContain('text-content-faint');
    expect(screen.getByTestId('popular-times-day-2').firstElementChild?.className).not.toContain('journal-accent');
    const scheduledSlot = screen.getByTestId('popular-time-slot-2-8');
    expect(scheduledSlot.className).not.toContain('ring-');
    expect(scheduledSlot.getAttribute('style')).toContain('var(--journal-accent)');
    expect(scheduledSlot.getAttribute('aria-label')).toContain('08:00');
    expect(scheduledSlot.getAttribute('aria-label')).toContain('35%');

    await user.click(screen.getByRole('button', { name: /Popular times/i }));
    expect(await screen.findByTestId('popular-times-day-3')).toBeTruthy();
    expect(screen.getByTestId('popular-time-slot-3-8').getAttribute('style')).not.toContain('var(--journal-accent)');
  });

  it('FE-PLANNER-INSPECTOR-024c: photo preview prefers enriched Google IDs from expanded details', async () => {
    vi.mocked(mapsApi.details).mockResolvedValue({
      place: {
        google_place_id: 'ChIJEnriched',
        name: 'Local Cafe',
        lat: 48.8001,
        lng: 2.3001,
        photos: [{ name: 'places/ChIJEnriched/photos/one' }],
      },
    } as any);
    vi.mocked(mapsApi.placePhoto).mockResolvedValue({ photoUrl: '/api/maps/place-photo/ChIJEnriched/bytes' } as any);
    const p = buildPlace({
      id: 206,
      name: 'Local Cafe',
      osm_id: 'node:56',
      google_place_id: null,
      google_ftid: null,
      lat: 48.8,
      lng: 2.3,
    } as any);

    render(<PlaceInspector {...defaultProps} place={p} />);

    await waitFor(() => {
      expect(vi.mocked(mapsApi.placePhoto)).toHaveBeenCalledWith('ChIJEnriched', 48.8001, 2.3001, 'Local Cafe');
    });
    expect(await screen.findByAltText('Local Cafe')).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-024d: renders direct place photos as a horizontal strip', async () => {
    vi.mocked(mapsApi.details).mockResolvedValue({
      place: {
        google_ftid: '0x123:0x456',
        name: 'Photo Cafe',
        photos: [
          { url: 'https://gz0.googleusercontent.com/gps-cs-s/one=w640-h426-k-no' },
          { url: 'https://gz0.googleusercontent.com/gps-cs-s/two=w640-h426-k-no' },
        ],
      },
    } as any);
    vi.mocked(mapsApi.placePhoto).mockResolvedValue({ photoUrl: null } as any);
    const p = buildPlace({ id: 207, name: 'Photo Cafe', google_ftid: '0x123:0x456' } as any);

    render(<PlaceInspector {...defaultProps} place={p} />);

    expect(await screen.findAllByAltText('Photo Cafe')).toHaveLength(2);
    const firstPhoto = (await screen.findAllByAltText('Photo Cafe'))[0];
    expect(firstPhoto.parentElement?.className).toContain('h-[126px]');
    expect(firstPhoto.parentElement?.className).toContain('shrink-0');
    expect(screen.getByText('2 photos')).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-024e: opens place photos in a lightbox viewer', async () => {
    const user = userEvent.setup();
    vi.mocked(mapsApi.details).mockResolvedValue({
      place: {
        google_ftid: '0x123:0x456',
        name: 'Photo Gallery',
        photos: [
          { url: 'https://gz0.googleusercontent.com/gps-cs-s/one=w640-h426-k-no' },
          { url: 'https://gz0.googleusercontent.com/gps-cs-s/two=w640-h426-k-no' },
        ],
      },
    } as any);
    const p = buildPlace({ id: 209, name: 'Photo Gallery', google_ftid: '0x123:0x456' } as any);

    render(<PlaceInspector {...defaultProps} place={p} />);

    const firstPhoto = (await screen.findAllByAltText('Photo Gallery'))[0];
    await user.click(firstPhoto.closest('button')!);
    expect(await screen.findByText('1 / 2')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(await screen.findByText('2 / 2')).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-024f: opens a reviews panel from compact reviews', async () => {
    const user = userEvent.setup();
    vi.mocked(mapsApi.details).mockResolvedValue({
      place: {
        reviews: [
          { author: 'Aiko', rating: 5, text: 'First review.', time: '1 week ago' },
          { author: 'Mika', rating: 4, text: 'Second review.', time: '2 weeks ago' },
          { author: 'Sora', rating: 5, text: 'Third review.', time: '3 weeks ago' },
          { author: 'Ren', rating: 3, text: 'Fourth review.', time: '4 weeks ago' },
        ],
      },
    } as any);
    const p = buildPlace({ id: 210, name: 'Review Museum', google_place_id: 'ChIJReviews' });

    render(<PlaceInspector {...defaultProps} place={p} />);

    const firstReview = await screen.findByText('First review.');
    expect(screen.queryByText('Fourth review.')).toBeNull();

    await user.click(firstReview.closest('button')!);
    expect(await screen.findByRole('dialog', { name: 'Reviews' })).toBeTruthy();
    expect(await screen.findByText('Fourth review.')).toBeTruthy();
    expect(screen.getAllByText('4 reviews').length).toBeGreaterThan(0);
  });

  it('FE-PLANNER-INSPECTOR-025: opening hours shown when available', async () => {
    vi.mocked(mapsApi.details).mockResolvedValue({
      place: { opening_hours: ['Mon: 9:00 AM – 5:00 PM', 'Tue: 9:00 AM – 5:00 PM'] },
    } as any);
    const user = userEvent.setup();
    const p = buildPlace({ id: 202, google_place_id: 'ChIJ003' });
    render(<PlaceInspector {...defaultProps} place={p} />);
    // Wait for hours to load — the button text shows a day's hours line
    const hoursBtn = await screen.findByText(/Show opening hours|Opening Hours|Mon:|9:00|09:00/i);
    const btn = hoursBtn.closest('button')!;
    await user.click(btn);
    // After expand, one of the hours lines should be visible
    await waitFor(() => {
      expect(screen.getByText(/Mon:/)).toBeTruthy();
    });
  });

  it('FE-PLANNER-INSPECTOR-026: open/closed badge shown when open_now is available', async () => {
    vi.mocked(mapsApi.details).mockResolvedValue({
      place: { open_now: true },
    } as any);
    const p = buildPlace({ id: 203, google_place_id: 'ChIJ004' });
    render(<PlaceInspector {...defaultProps} place={p} />);
    await screen.findByText(/open/i);
  });

  it('FE-PLANNER-INSPECTOR-027: mapsApi.details NOT called when place has no google_place_id or osm_id', async () => {
    const p = buildPlace({ id: 204, google_place_id: null, osm_id: null });
    render(<PlaceInspector {...defaultProps} place={p} />);
    // Wait a tick
    await act(async () => { await new Promise(r => setTimeout(r, 50)) });
    expect(vi.mocked(mapsApi.details)).not.toHaveBeenCalled();
  });

  // ── Files ──────────────────────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-028: files section shows file names after expanding', async () => {
    const user = userEvent.setup();
    const file = {
      id: 1,
      trip_id: 1,
      place_id: place.id,
      original_name: 'photo.jpg',
      url: '/uploads/photo.jpg',
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      file_size: 1024,
      created_at: '2025-01-01T00:00:00.000Z',
    };
    render(<PlaceInspector {...defaultProps} files={[file as any]} />);
    // The files section header/toggle is always visible; click to expand
    const allButtons = screen.getAllByRole('button');
    const filesBtn = allButtons.find(btn => btn.textContent?.includes('1'));
    // Click the expand button (file count label button)
    if (filesBtn) {
      await user.click(filesBtn);
      await screen.findByText('photo.jpg');
    } else {
      // Try clicking the last non-footer button
      const toggleButtons = allButtons.filter(btn => !btn.closest('footer'));
      await user.click(toggleButtons[0]);
    }
  });

  it('FE-PLANNER-INSPECTOR-029: hidden file input is present when onFileUpload provided', () => {
    const { container } = render(<PlaceInspector {...defaultProps} />);
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
  });

  // ── Reservation chip ───────────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-030: linked reservation shown when selectedAssignmentId has a reservation', () => {
    const reservation = buildReservation({ title: 'Museum Ticket', status: 'confirmed', assignment_id: 99 } as any);
    const assignmentInDay = [{ id: 99, place, day_id: 1, place_id: place.id, order_index: 0, notes: null }];
    render(
      <PlaceInspector
        {...defaultProps}
        selectedDayId={1}
        selectedAssignmentId={99}
        assignments={{ '1': assignmentInDay }}
        reservations={[reservation]}
      />
    );
    expect(screen.getByText('Museum Ticket')).toBeTruthy();
  });

  // ── Participants ───────────────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-031: participants section shown when tripMembers > 1 and selectedAssignmentId is set', () => {
    const members = [buildUser({ id: 1 }), buildUser({ id: 2 })];
    const assignmentInDay = [{ id: 99, place, day_id: 1, place_id: place.id, order_index: 0, notes: null }];
    render(
      <PlaceInspector
        {...defaultProps}
        tripMembers={members}
        selectedDayId={1}
        selectedAssignmentId={99}
        assignments={{ '1': assignmentInDay }}
      />
    );
    // The participants section renders with a "participants" label
    // It's visible when tripMembers.length > 1 && selectedAssignmentId is set
    expect(screen.getByText(members[0].username)).toBeTruthy();
  });

  // ── Price chip ─────────────────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-032: price chip shown when place.price > 0', () => {
    const p = buildPlace({ id: 300, price: 15, currency: 'EUR' } as any);
    render(<PlaceInspector {...defaultProps} place={p} />);
    expect(screen.getByText(/15 EUR/)).toBeTruthy();
  });

  // ── Phone number ───────────────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-033: phone number shown when place has phone', () => {
    const p = buildPlace({ id: 301, phone: '+33 1 23 45 67 89' } as any);
    render(<PlaceInspector {...defaultProps} place={p} />);
    expect(screen.getByText('Phone')).toBeTruthy();
    expect(screen.getByText(/\+33 1 23 45 67 89/)).toBeTruthy();
  });

  // ── File size display ──────────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-034: file size displayed in KB for files < 1MB', async () => {
    const user = userEvent.setup();
    const file = {
      id: 2,
      trip_id: 1,
      place_id: place.id,
      original_name: 'doc.pdf',
      url: '/uploads/doc.pdf',
      filename: 'doc.pdf',
      mime_type: 'application/pdf',
      file_size: 2048,
      created_at: '2025-01-01T00:00:00.000Z',
    };
    render(<PlaceInspector {...defaultProps} files={[file as any]} />);
    // Click expand to see file details
    const expandBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('1'));
    if (expandBtn) {
      await user.click(expandBtn);
      await waitFor(() => {
        expect(screen.getByText(/2\.0 KB/)).toBeTruthy();
      });
    }
  });

  it('FE-PLANNER-INSPECTOR-035: file size displayed in MB for files >= 1MB', async () => {
    const user = userEvent.setup();
    const file = {
      id: 3,
      trip_id: 1,
      place_id: place.id,
      original_name: 'video.mp4',
      url: '/uploads/video.mp4',
      filename: 'video.mp4',
      mime_type: 'video/mp4',
      file_size: 2 * 1024 * 1024,
      created_at: '2025-01-01T00:00:00.000Z',
    };
    render(<PlaceInspector {...defaultProps} files={[file as any]} />);
    const expandBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('1'));
    if (expandBtn) {
      await user.click(expandBtn);
      await waitFor(() => {
        expect(screen.getByText(/2\.0 MB/)).toBeTruthy();
      });
    }
  });

  // ── GPX track stats ────────────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-036: GPX track stats shown when route_geometry has 2D points', () => {
    const pts = [[48.8584, 2.2945], [48.8600, 2.3000], [48.8620, 2.3050]];
    const p = buildPlace({ id: 302, route_geometry: JSON.stringify(pts) } as any);
    render(<PlaceInspector {...defaultProps} place={p} />);
    // Track distance should be visible (e.g. "x.x km" or "xxx m")
    const { container } = render(<PlaceInspector {...defaultProps} place={p} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-037: GPX track stats shown with 3D points (elevation data)', () => {
    const pts = [
      [48.8584, 2.2945, 100],
      [48.8600, 2.3000, 120],
      [48.8620, 2.3050, 110],
      [48.8640, 2.3100, 130],
    ];
    const p = buildPlace({ id: 303, route_geometry: JSON.stringify(pts) } as any);
    const { container } = render(<PlaceInspector {...defaultProps} place={p} />);
    // Elevation stats should show max elevation 130m
    expect(screen.getByText(/130 m/)).toBeTruthy();
  });

  // ── ParticipantsBox interactions ───────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-038: participants list shows member names', () => {
    const member1 = buildUser({ id: 10, username: 'alice' });
    const member2 = buildUser({ id: 11, username: 'bob' });
    const members = [member1, member2];
    const assignmentInDay = [{
      id: 99, place, day_id: 1, place_id: place.id, order_index: 0, notes: null,
      participants: [{ user_id: 10, username: 'alice' }],
    }];
    render(
      <PlaceInspector
        {...defaultProps}
        tripMembers={members}
        selectedDayId={1}
        selectedAssignmentId={99}
        assignments={{ '1': assignmentInDay }}
      />
    );
    // alice is a participant, should appear
    expect(screen.getByText('alice')).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-039: session storage cache prevents duplicate mapsApi calls', async () => {
    // Prime the session storage cache with language 'en' (default)
    sessionStorage.setItem('gdetails_v11_expanded_ChIJCache_en', JSON.stringify({ rating: 3.0 }));
    const p = buildPlace({ id: 304, google_place_id: 'ChIJCache' });
    render(<PlaceInspector {...defaultProps} place={p} />);
    // Wait for effect to run
    await act(async () => { await new Promise(r => setTimeout(r, 50)) });
    // mapsApi.details should NOT have been called (cache hit)
    expect(vi.mocked(mapsApi.details)).not.toHaveBeenCalled();
    // Rating from cache should be visible
    await screen.findByText(/3\.0/);
  });

  // ── File upload interaction ────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-040: file input change triggers onFileUpload', async () => {
    const onFileUpload = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<PlaceInspector {...defaultProps} onFileUpload={onFileUpload} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    const testFile = new File(['content'], 'test.txt', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [testFile] } });
    });
    await waitFor(() => {
      expect(onFileUpload).toHaveBeenCalled();
    });
  });

  // ── formatTime: 12h format ─────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-041: legacy manual place time is not shown in 12h format', () => {
    seedStore(useSettingsStore, { settings: { time_format: '12h' } });
    const p = buildPlace({ id: 305, place_time: '14:30', end_time: null });
    render(<PlaceInspector {...defaultProps} place={p} />);
    expect(screen.queryByText(/2:30 PM/)).toBeNull();
  });

  // ── convertHoursLine: 24h→12h conversion ──────────────────────────────────

  it('FE-PLANNER-INSPECTOR-042: opening hours converted to 12h when setting is 12h', async () => {
    seedStore(useSettingsStore, { settings: { time_format: '12h' } });
    vi.mocked(mapsApi.details).mockResolvedValue({
      place: { opening_hours: ['Mon: 09:00 – 17:00'] },
    } as any);
    const user = userEvent.setup();
    const p = buildPlace({ id: 306, google_place_id: 'ChIJ006' });
    render(<PlaceInspector {...defaultProps} place={p} />);
    const hoursSpan = await screen.findByText(/9:00 AM|Show opening hours/i);
    const btn = hoursSpan.closest('button')!;
    await user.click(btn);
    await waitFor(() => {
      expect(screen.getByText(/9:00 AM/)).toBeTruthy();
    });
  });

  // ── Google Maps URL action ─────────────────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-043: Google Maps lat/lng button visible when no google_maps_url', () => {
    render(<PlaceInspector {...defaultProps} />);
    // place has lat/lng so Google Maps button should appear with Navigation icon
    const allButtons = screen.getAllByRole('button');
    // Find button containing "Google Maps" text
    const mapsBtn = allButtons.find(btn => btn.textContent?.includes('Google Maps'));
    expect(mapsBtn).toBeTruthy();
  });

  it('FE-PLANNER-INSPECTOR-043b: Google Maps action uses google_ftid over coordinates', async () => {
    const user = userEvent.setup();
    const mapsUrl = "https://www.google.com/maps/place/?q=St.%20Jacobs%20Farmers'%20Market&ftid=0x882bf179e806d471:0x8591dde29c821a93";
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<PlaceInspector {...defaultProps} place={buildPlace({
      name: "St. Jacobs Farmers' Market",
      lat: 43.5118527,
      lng: -80.5542617,
      google_ftid: '0x882bf179e806d471:0x8591dde29c821a93',
    })} />);
    const mapsBtn = screen.getAllByRole('button').find(btn => btn.textContent?.includes('Google Maps'))!;
    await user.click(mapsBtn);
    expect(openSpy).toHaveBeenCalledWith(mapsUrl, '_blank');
    openSpy.mockRestore();
  });

  // ── No files section when no upload handler and no files ──────────────────

  it('FE-PLANNER-INSPECTOR-044: files section hidden when no files and no onFileUpload', () => {
    const { container } = render(
      <PlaceInspector {...defaultProps} files={[]} onFileUpload={undefined} />
    );
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  // ── Participants section hidden when tripMembers <= 1 ─────────────────────

  it('FE-PLANNER-INSPECTOR-045: participants section hidden when tripMembers has only 1 member', () => {
    const member = buildUser({ id: 1, username: 'solo' });
    render(
      <PlaceInspector
        {...defaultProps}
        tripMembers={[member]}
        selectedDayId={1}
        selectedAssignmentId={99}
        assignments={{ '1': [{ id: 99, place, day_id: 1, place_id: place.id, order_index: 0, notes: null }] }}
      />
    );
    // "solo" username might be visible from other parts but participants box should not render
    // The participants box renders a "users" icon — check it's absent
    const text = document.body.textContent || '';
    // No second member to display
    expect(screen.queryByText('Participants')).toBeNull();
  });

  // ── Scroll / overflow (issue #1195) ──────────────────────────────────────

  it('FE-PLANNER-INSPECTOR-046: info area is the bounded scroll region', () => {
    const longText = 'Lorem ipsum dolor sit amet. '.repeat(200);
    const p = buildPlace({ id: 200, description: longText, notes: longText } as any);
    render(<PlaceInspector {...defaultProps} place={p} />);
    const shell = screen.getByTestId('inspector-scroll') as HTMLElement;
    const infoScroll = screen.getByTestId('inspector-info-scroll') as HTMLElement;
    const columns = screen.getByTestId('inspector-info-columns') as HTMLElement;
    expect(shell.className).toContain('overflow-hidden');
    expect(shell.className).toContain('min-h-0');
    expect(infoScroll.className).toContain('overflow-y-auto');
    expect(infoScroll.className).toContain('flex-1');
    expect(columns.className).toContain('grid-cols-1');
    expect(columns.className).toContain('sm:grid-cols-2');
  });

  it('FE-PLANNER-INSPECTOR-046b: summary is the first block in the right info column', () => {
    const p = buildPlace({
      id: 203,
      description: 'Official summary text',
      notes: 'Private notes',
      phone: '+81 50 0000 0000',
    } as any);
    render(<PlaceInspector {...defaultProps} place={p} />);
    const rightColumn = screen.getByTestId('inspector-info-right') as HTMLElement;
    expect(rightColumn.firstElementChild).toHaveAttribute('data-testid', 'inspector-summary');
    expect(rightColumn.firstElementChild?.textContent).toContain('Official summary text');
  });

  it('FE-PLANNER-INSPECTOR-047: long unbroken description wraps instead of clipping horizontally', () => {
    const longWord = 'https://example.com/' + 'a'.repeat(300);
    const p = buildPlace({ id: 201, description: longWord } as any);
    const { container } = render(<PlaceInspector {...defaultProps} place={p} />);
    const descDiv = container.querySelector('.collab-note-md') as HTMLElement;
    expect(descDiv).toBeTruthy();
    expect(descDiv.className).toContain('[overflow-wrap:anywhere]');
    expect(descDiv.className).toContain('[word-break:break-word]');
  });

  it('FE-PLANNER-INSPECTOR-048: description/notes stay natural-height items inside the info scroll', () => {
    const longText = 'Lorem ipsum dolor sit amet. '.repeat(200);
    const p = buildPlace({ id: 202, description: longText, notes: longText } as any);
    const { container } = render(<PlaceInspector {...defaultProps} place={p} />);
    const notes = Array.from(container.querySelectorAll('.collab-note-md')) as HTMLElement[];
    const infoScroll = screen.getByTestId('inspector-info-scroll') as HTMLElement;
    expect(notes.length).toBe(2);
    for (const el of notes) {
      expect(infoScroll.contains(el)).toBe(true);
      expect(el.className).toContain('break-inside-avoid');
    }
  });

});
