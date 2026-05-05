<script>
    import { normalizeDateRange } from '$lib/shared/task-domain.js';

    let {
        startDate = $bindable(),
        endDate = $bindable(),
        idPrefix = 'date-range',
        onchange = () => {}
    } = $props();

    /** @type {Date | null} */
    let anchorDate = $state(null);
    let isSelectingRange = $state(false);
    let isCalendarOpen = $state(false);
    let calendarMonth = $state(parseLocalDate(startDate));

    const monthLabel = $derived(calendarMonth.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long'
    }));
    const calendarDays = $derived.by(() => buildCalendarDays(calendarMonth));
    const normalizedRange = $derived(normalizeDateRange(startDate, endDate));
    const selectedStart = $derived(parseLocalDate(normalizedRange.startDate));
    const selectedEnd = $derived(parseLocalDate(normalizedRange.endDate));

    $effect(() => {
        const normalized = normalizeDateRange(startDate, endDate);
        if (normalized.startDate !== startDate) {
            startDate = normalized.startDate;
        }
        if (normalized.endDate !== endDate) {
            endDate = normalized.endDate;
        }
    });

    function toggleCalendar() {
        isCalendarOpen = !isCalendarOpen;
        if (isCalendarOpen) {
            calendarMonth = startOfMonth(parseLocalDate(startDate));
        }
    }

    /**
     * @param {number} offset
     */
    function moveMonth(offset) {
        const next = new Date(calendarMonth);
        next.setMonth(next.getMonth() + offset);
        calendarMonth = startOfMonth(next);
    }

    /**
     * @param {Date} date
     */
    function selectDate(date) {
        if (!isSelectingRange || !anchorDate) {
            anchorDate = date;
            isSelectingRange = true;
            commitRange(formatDate(date), formatDate(date));
            return;
        }

        const start = date < anchorDate ? date : anchorDate;
        const end = date < anchorDate ? anchorDate : date;
        commitRange(formatDate(start), formatDate(end));
        anchorDate = null;
        isSelectingRange = false;
    }

    /**
     * @param {Event} event
     */
    function handleStartInput(event) {
        const nextStartDate = /** @type {HTMLInputElement} */ (event.currentTarget).value;
        const next = normalizeDateRange(nextStartDate, endDate);
        commitRange(next.startDate, next.endDate);
        calendarMonth = startOfMonth(parseLocalDate(startDate));
    }

    /**
     * @param {Event} event
     */
    function handleEndInput(event) {
        const nextEndDate = /** @type {HTMLInputElement} */ (event.currentTarget).value;
        const next = normalizeDateRange(startDate, nextEndDate);
        commitRange(next.startDate, next.endDate);
    }

    /**
     * @param {string} nextStartDate
     * @param {string} nextEndDate
     */
    function commitRange(nextStartDate, nextEndDate) {
        startDate = nextStartDate;
        endDate = nextEndDate;
        onchange({ startDate, endDate });
    }

    /**
     * @param {KeyboardEvent} event
     */
    function handleCalendarKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            isCalendarOpen = false;
        }
    }

    /**
     * @param {Date} date
     */
    function isSelectedBoundary(date) {
        return isSameDate(date, selectedStart) || isSameDate(date, selectedEnd);
    }

    /**
     * @param {Date} date
     */
    function isInSelectedRange(date) {
        return date >= selectedStart && date <= selectedEnd;
    }

    /**
     * @param {Date} date
     */
    function isToday(date) {
        return isSameDate(date, parseLocalDate(formatDate(new Date())));
    }

    /**
     * @param {string | undefined} value
     */
    function parseLocalDate(value) {
        const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? value
            : formatDate(new Date());
        return new Date(`${normalized}T12:00:00`);
    }

    /**
     * @param {Date} date
     */
    function startOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth(), 1, 12);
    }

    /**
     * @param {Date} date
     */
    function formatDate(date) {
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * @param {Date} left
     * @param {Date} right
     */
    function isSameDate(left, right) {
        return formatDate(left) === formatDate(right);
    }

    /**
     * @param {Date} month
     */
    function buildCalendarDays(month) {
        const firstDay = startOfMonth(month);
        const gridStart = new Date(firstDay);
        gridStart.setDate(gridStart.getDate() - gridStart.getDay());

        return Array.from({ length: 42 }, (_, index) => {
            const date = new Date(gridStart);
            date.setDate(gridStart.getDate() + index);
            return {
                date,
                key: formatDate(date),
                label: String(date.getDate()),
                inMonth: date.getMonth() === month.getMonth()
            };
        });
    }
</script>

<div class="date-picker">
    <div class="date-range">
        <input
            id={`${idPrefix}-start-date`}
            class="form-input form-date-input"
            type="date"
            value={startDate}
            oninput={handleStartInput} />
        <span class="range-separator">~</span>
        <input
            id={`${idPrefix}-end-date`}
            class="form-input form-date-input"
            type="date"
            value={endDate}
            oninput={handleEndInput} />
        <button
            class="date-picker-toggle"
            type="button"
            aria-expanded={isCalendarOpen}
            aria-controls={`${idPrefix}-calendar`}
            onclick={toggleCalendar}>
            📅
        </button>
    </div>

    {#if isCalendarOpen}
        <div
            class="date-picker-popover"
            id={`${idPrefix}-calendar`}
            role="dialog"
            aria-label="일정 선택"
            tabindex="-1"
            onkeydown={handleCalendarKeydown}>
            <div class="date-picker-header">
                <button class="date-picker-nav" type="button" aria-label="이전 달" onclick={() => moveMonth(-1)}>‹</button>
                <strong>{monthLabel}</strong>
                <button class="date-picker-nav" type="button" aria-label="다음 달" onclick={() => moveMonth(1)}>›</button>
            </div>

            <div class="date-picker-weekdays" aria-hidden="true">
                {#each ['일', '월', '화', '수', '목', '금', '토'] as day}
                    <span>{day}</span>
                {/each}
            </div>

            <div class="date-picker-grid">
                {#each calendarDays as day (day.key)}
                    <button
                        class="date-picker-day"
                        class:muted={!day.inMonth}
                        class:today={isToday(day.date)}
                        class:in-range={isInSelectedRange(day.date)}
                        class:boundary={isSelectedBoundary(day.date)}
                        type="button"
                        aria-pressed={isInSelectedRange(day.date)}
                        onclick={() => selectDate(day.date)}>
                        {day.label}
                    </button>
                {/each}
            </div>

            <div class="date-picker-footer">
                <button class="btn btn-small" type="button" onclick={() => isCalendarOpen = false}>완료</button>
            </div>
        </div>
    {/if}
</div>
