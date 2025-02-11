import { derived, writable, get } from 'svelte/store';
import type { Readable, Writable } from 'svelte/store';
import { persist, localStorage } from '$lib/util/persist';
import { generateSlug } from 'random-word-slugs';
import type { HistoryEntry, HistoryType, Optional } from '$lib/types';
import { v4 as uuidV4 } from 'uuid';
import { logEvent } from '$lib/util/stats';

const MAX_AUTO_HISTORY_LENGTH = 30;

export const historyModeStore: Writable<HistoryType> = persist(
  writable('manual'),
  localStorage(),
  'autoHistoryMode'
);

const autoHistoryStore: Writable<HistoryEntry[]> = persist(
  writable([]),
  localStorage(),
  'autoHistoryStore'
);

const manualHistoryStore: Writable<HistoryEntry[]> = persist(
  writable([]),
  localStorage(),
  'manualHistoryStore'
);

export const loaderHistoryStore: Writable<HistoryEntry[]> = writable([] as HistoryEntry[]);

export const historyStore: Readable<HistoryEntry[]> = derived(
  [historyModeStore, autoHistoryStore, manualHistoryStore, loaderHistoryStore],
  ([historyMode, autoHistories, manualHistories, loadedHistories], set) => {
    if (historyMode === 'auto') {
      set(autoHistories);
    } else if (historyMode === 'manual') {
      set(manualHistories);
    } else if (historyMode === 'loader') {
      set(loadedHistories);
    } else {
      set(autoHistories);
    }
  }
);

export const addHistoryEntry = (entryToAdd: Optional<HistoryEntry, 'id'>): void => {
  const entry: HistoryEntry = {
    ...entryToAdd,
    id: uuidV4()
  };

  if (entry.type === 'loader') {
    loaderHistoryStore.update((entries) => [entry, ...entries]);
    return;
  }

  if (!entry.name) {
    entry.name = generateSlug(2);
  }

  if (entry.type === 'auto') {
    autoHistoryStore.update((entries) => {
      if (entries.length >= MAX_AUTO_HISTORY_LENGTH) {
        entries = entries.slice(0, MAX_AUTO_HISTORY_LENGTH - 1);
      }
      return [entry, ...entries];
    });
  } else if (entry.type === 'manual') {
    manualHistoryStore.update((entries) => [entry, ...entries]);
    logEvent('history', { action: 'save' });
  }
};

export const clearHistoryData = (idToClear?: string): void => {
  (get(historyModeStore) === 'auto' ? autoHistoryStore : manualHistoryStore).update((entries) => {
    if (get(historyModeStore) !== 'loader') {
      entries = entries.filter(({ id }) => idToClear && id != idToClear);
      logEvent('history', { action: 'clear', type: idToClear ? 'single' : 'all' });
    }
    return entries;
  });
};

export const getPreviousState = (auto: boolean): string => {
  const entries = get(auto ? autoHistoryStore : manualHistoryStore);
  if (entries.length > 0) {
    return JSON.stringify(entries[0].state);
  }
  return '';
};

export const restoreHistory = (data: HistoryEntry[]) => {
  const entries = data.filter(validateEntry);
  const invalidEntryCount = data.length - entries.length;
  if (invalidEntryCount > 0) {
    console.error(`${invalidEntryCount} invalid history entries were removed.`);
    console.error(data);
  }
  if (entries.length > 0) {
    let entryCount = 0;
    (entries[0].type === 'auto' ? autoHistoryStore : manualHistoryStore).update((existing) => {
      const existingIDs = new Set(existing.map(({ id }) => id));
      const newEntries = entries.filter(({ id }) => !existingIDs.has(id));
      entryCount = newEntries.length;
      const combined = [...existing, ...newEntries];
      combined.sort((a, b) => b.time - a.time);
      return combined;
    });

    alert(
      `${entryCount} entries restored. ${invalidEntryCount} invalid, ${
        entries.length - entryCount
      } duplicates.`
    );
    logEvent('history', {
      action: 'restore',
      success: entryCount,
      invalid: invalidEntryCount,
      duplicates: entries.length - entryCount
    });
  } else {
    alert('No valid entries found.');
  }
};

export const injectHistoryIDs = (): void => {
  const setIDs = (entries: HistoryEntry[]) => {
    for (const entry of entries) {
      if (!entry.id) {
        entry.id = uuidV4();
      }
    }
    return entries;
  };
  autoHistoryStore.update(setIDs);
  manualHistoryStore.update(setIDs);
};

const validateEntry = (entry: HistoryEntry): boolean => {
  return entry.type && entry.state && entry.time && true;
};
