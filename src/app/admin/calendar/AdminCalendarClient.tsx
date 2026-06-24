"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  updateAdminCalendarAttendance,
  createAdminCalendarEventsForDates,
  createAdminCalendarEventFromModal,
  updateAdminCalendarEventFromModal,
} from "./actions";

type CurrentAdmin = {
  id: string;
  name: string;
  group_id: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  time_text: string | null;
  start_at: string;
  end_at: string | null;
  is_holiday: boolean;
  title_color: string | null;
  location_color: string | null;
  time_color: string | null;
  attendance_required: boolean;
  display_type: string;
};

type EventResponse = {
  event_id: string;
  user_id: string;
  status: string;
};

type EventSummary = {
  attend: number;
  pending: number;
  absent: number;
  coachAttend: number;
  playerAttend: number;
};

type AdminCalendarClientProps = {
  currentAdmin: CurrentAdmin;
  currentYear: number;
  currentMonth: number;
  todayKey: string;
  events: CalendarEvent[];
  adminResponses: EventResponse[];
  summariesByEvent: Record<string, EventSummary>;
};

const WEEKDAYS = [
  { label: "月", value: 1 },
  { label: "火", value: 2 },
  { label: "水", value: 3 },
  { label: "木", value: 4 },
  { label: "金", value: 5 },
  { label: "土", value: 6 },
  { label: "日", value: 0 },
];

const STATUS_OPTIONS = [
  { value: "", label: "未回答" },
  { value: "attend", label: "〇 出席" },
  { value: "pending", label: "△ 未定" },
  { value: "absent", label: "× 欠席" },
];

const LONG_PRESS_MS = 450;
const SCROLL_MOVE_THRESHOLD = 14;

const fieldClass =
  "mt-1 block w-full min-w-0 max-w-full box-border rounded border border-gray-400 px-3 py-2 text-base";

function toDateKeyFromParts(year: number, month: number, date = 1) {
  return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(
    2,
    "0"
  )}`;
}

function getEventDateKey(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${dateKey}T00:00:00+09:00`));
}

function formatShortDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${dateKey}T00:00:00+09:00`));
}

function getMonthDaysMondayStart(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  const firstWeekday = firstDay.getDay();
  const offset = (firstWeekday + 6) % 7;
  const lastDate = lastDay.getDate();

  const cells: Array<{
    dateKey: string;
    day: number;
    weekday: number;
  } | null> = [];

  for (let i = 0; i < offset; i++) {
    cells.push(null);
  }

  for (let date = 1; date <= lastDate; date++) {
    const value = new Date(year, month - 1, date);

    cells.push({
      dateKey: toDateKeyFromParts(year, month, date),
      day: date,
      weekday: value.getDay(),
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function getPrevMonth(year: number, month: number) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function getNextMonth(year: number, month: number) {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

function visualLength(value: string | null | undefined) {
  const text = String(value ?? "").replace(/\s+/g, "");
  let count = 0;

  for (const char of Array.from(text)) {
    // 半角英数字・記号は0.5、全角文字は1として扱う
    count += /^[\x20-\x7E]$/.test(char) ? 0.5 : 1;
  }

  return count;
}

function displayText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("\n");
}

function isTimeLikeText(value: string | null | undefined) {
  const text = String(value ?? "").trim();

  // 9:00-12:00 / 09:00〜12:00 / 18:30-21:00 など
  return /^\d{1,2}[:：]\d{2}\s*[-ー－〜~]\s*\d{1,2}[:：]\d{2}$/.test(
    text
  );
}

function calendarTextStyle(
  value: string | null | undefined,
  color: string | null | undefined
): CSSProperties {
  const text = displayText(value);
  const length = visualLength(text);
  const hasLineBreak = text.includes("\n");
  const isTimeText = isTimeLikeText(text);

  // 時間表記は潰さない。
  // 9:00-12:00 は半角なので visualLength では短く見えるが、
  // 実際の表示幅は広いため、横圧縮と強い字間詰めを使わない。
  if (isTimeText) {
    return {
      color: color || "#111827",
      display: "block",
      width: "100%",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "clip",
      fontSize: "8.5px",
      lineHeight: "1.08",
      letterSpacing: "-0.03em",
      transform: "none",
      fontVariantNumeric: "tabular-nums",
    };
  }

  // 改行なし・全角5文字以内は1行表示を優先。
  if (!hasLineBreak && length <= 5) {
    // 4文字以下はすべて「4文字の時」と同じサイズに統一。
    // 例：練習 / 試合 / 合同練習 などで文字サイズがバラつかないようにする。
    const fontSize = length <= 4 ? "10.2px" : "8.6px";

    const letterSpacing = length >= 5 ? "-0.14em" : "-0.04em";

    return {
      color: color || "#111827",
      display: "block",
      width: "100%",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "clip",
      fontSize,
      lineHeight: "1.08",
      letterSpacing,
      transform: "none",
      transformOrigin: "center",
    };
  }

  // 長い文字だけ最大2行表示
  return {
    color: color || "#111827",
    display: "-webkit-box",
    overflow: "hidden",
    whiteSpace: "pre-line",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    fontSize: length >= 12 ? "8px" : length >= 8 ? "8.5px" : "9px",
    lineHeight: "1.1",
    letterSpacing: length >= 10 ? "-0.06em" : "-0.03em",
  };
}

function statusCalendarLabel(status: string | null | undefined) {
  if (status === "attend") return "〇";
  if (status === "pending") return "△";
  if (status === "absent") return "×";
  return "未回答";
}

function statusLongLabel(status: string | null | undefined) {
  if (status === "attend") return "〇 出席";
  if (status === "pending") return "△ 未定";
  if (status === "absent") return "× 欠席";
  return "未回答";
}

function statusPillClass(status: string | null | undefined) {
  if (status === "attend") return "bg-green-500 text-white";
  if (status === "pending") return "bg-yellow-500 text-white";
  if (status === "absent") return "bg-red-500 text-white";
  return "bg-orange-500 text-white";
}

function statusButtonClass(status: string, currentStatus: string) {
  const isSelected = status === currentStatus;

  if (!isSelected) return "border-gray-300 bg-white text-gray-700";
  if (status === "attend") return "border-green-500 bg-green-500 text-white";
  if (status === "pending") return "border-yellow-500 bg-yellow-500 text-white";
  if (status === "absent") return "border-red-500 bg-red-500 text-white";

  return "border-orange-500 bg-orange-500 text-white";
}

function uniqueSortedDateKeys(dateKeys: string[]) {
  return Array.from(new Set(dateKeys)).sort();
}

export default function AdminCalendarClient({
  currentAdmin,
  currentYear,
  currentMonth,
  todayKey,
  events,
  adminResponses,
  summariesByEvent,
}: AdminCalendarClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [bulkDateKeys, setBulkDateKeys] = useState<string[]>([]);
  const [dragDateKeys, setDragDateKeysState] = useState<string[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  const [newTitle, setNewTitle] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newTimeText, setNewTimeText] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAttendanceRequired, setNewAttendanceRequired] = useState(true);
  const [newIsPeriod, setNewIsPeriod] = useState(false);
  const [newIsHoliday, setNewIsHoliday] = useState(false);
  const [newTitleColor, setNewTitleColor] = useState("#111827");
  const [newLocationColor, setNewLocationColor] = useState("#111827");
  const [newTimeColor, setNewTimeColor] = useState("#111827");

  const [editDateKey, setEditDateKey] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editTimeText, setEditTimeText] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAttendanceRequired, setEditAttendanceRequired] = useState(true);
  const [editIsPeriod, setEditIsPeriod] = useState(false);
  const [editIsHoliday, setEditIsHoliday] = useState(false);
  const [editTitleColor, setEditTitleColor] = useState("#111827");
  const [editLocationColor, setEditLocationColor] = useState("#111827");
  const [editTimeColor, setEditTimeColor] = useState("#111827");

  const [bulkCreateTitle, setBulkCreateTitle] = useState("");
  const [bulkCreateLocation, setBulkCreateLocation] = useState("");
  const [bulkCreateTimeText, setBulkCreateTimeText] = useState("");
  const [bulkCreateDescription, setBulkCreateDescription] = useState("");
  const [bulkCreateAttendanceRequired, setBulkCreateAttendanceRequired] =
    useState(true);
  const [bulkCreateIsPeriod, setBulkCreateIsPeriod] = useState(false);
  const [bulkCreateIsHoliday, setBulkCreateIsHoliday] = useState(false);

  const longPressTimerRef = useRef<number | null>(null);
  const dragDateKeysRef = useRef<string[]>([]);
  const captureElementRef = useRef<HTMLElement | null>(null);
  const capturedPointerIdRef = useRef<number | null>(null);

  const pointerStateRef = useRef({
    down: false,
    selectionActive: false,
    startKey: "",
    startX: 0,
    startY: 0,
    movedBeforeLongPress: false,
  });

  const [localResponses, setLocalResponses] = useState<Record<string, string>>(
    () => {
      const result: Record<string, string> = {};

      for (const response of adminResponses) {
        result[response.event_id] = response.status;
      }

      return result;
    }
  );

  useEffect(() => {
    const result: Record<string, string> = {};

    for (const response of adminResponses) {
      result[response.event_id] = response.status;
    }

    setLocalResponses(result);
  }, [adminResponses]);

  useEffect(() => {
    if (!isSelecting) return;

    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;
    const originalOverscrollBehavior = document.body.style.overscrollBehavior;

    function preventTouchMove(event: TouchEvent) {
      event.preventDefault();
    }

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    document.body.style.overscrollBehavior = "none";

    document.addEventListener("touchmove", preventTouchMove, {
      passive: false,
    });

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
      document.body.style.overscrollBehavior = originalOverscrollBehavior;

      document.removeEventListener("touchmove", preventTouchMove);
    };
  }, [isSelecting]);

  const monthCells = useMemo(
    () => getMonthDaysMondayStart(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const eventsByDate = useMemo(() => {
    const result: Record<string, CalendarEvent[]> = {};

    for (const event of events) {
      const dateKey = getEventDateKey(event.start_at);

      if (!result[dateKey]) result[dateKey] = [];
      result[dateKey].push(event);
    }

    return result;
  }, [events]);

  const selectedDateEvents = selectedDateKey
    ? eventsByDate[selectedDateKey] ?? []
    : [];

  const selectedEvent =
    selectedEventId && events.find((event) => event.id === selectedEventId)
      ? events.find((event) => event.id === selectedEventId) ?? null
      : null;

  useEffect(() => {
    if (!selectedEvent) return;

    setEditDateKey(getEventDateKey(selectedEvent.start_at));
    setEditTitle(selectedEvent.title);
    setEditLocation(selectedEvent.location ?? "");
    setEditTimeText(selectedEvent.time_text ?? "");
    setEditDescription(selectedEvent.description ?? "");
    setEditAttendanceRequired(selectedEvent.attendance_required);
    setEditIsPeriod(selectedEvent.display_type === "period");
    setEditIsHoliday(selectedEvent.is_holiday);
    setEditTitleColor(selectedEvent.title_color || "#111827");
    setEditLocationColor(selectedEvent.location_color || "#111827");
    setEditTimeColor(selectedEvent.time_color || "#111827");
  }, [selectedEvent]);

  const bulkEvents = useMemo(() => {
    return uniqueSortedDateKeys(bulkDateKeys).flatMap((dateKey) => {
      const dayEvents = eventsByDate[dateKey] ?? [];

      return dayEvents.map((event) => ({
        dateKey,
        event,
      }));
    });
  }, [bulkDateKeys, eventsByDate]);

  const bulkAnswerTargets = bulkEvents.filter(
    ({ event }) => event.attendance_required
  );

  const prev = getPrevMonth(currentYear, currentMonth);
  const next = getNextMonth(currentYear, currentMonth);

  function resetNewEventForm() {
    setNewTitle("");
    setNewLocation("");
    setNewTimeText("");
    setNewDescription("");
    setNewAttendanceRequired(true);
    setNewIsPeriod(false);
    setNewIsHoliday(false);
    setNewTitleColor("#111827");
    setNewLocationColor("#111827");
    setNewTimeColor("#111827");
  }

  function setDragKeys(dateKeys: string[]) {
    const next = uniqueSortedDateKeys(dateKeys);
    dragDateKeysRef.current = next;
    setDragDateKeysState(next);
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function releasePointerCapture() {
    const element = captureElementRef.current;
    const pointerId = capturedPointerIdRef.current;

    if (element && pointerId !== null) {
      try {
        if (element.hasPointerCapture(pointerId)) {
          element.releasePointerCapture(pointerId);
        }
      } catch {
        // ignore
      }
    }

    captureElementRef.current = null;
    capturedPointerIdRef.current = null;
  }

  function openDayModal(dateKey: string) {
    const dayEvents = eventsByDate[dateKey] ?? [];

    setSelectedDateKey(dateKey);
    setSelectedEventId(dayEvents[0]?.id ?? null);
    setBulkDateKeys([]);
    setDragKeys([]);
    setIsSelecting(false);
    setErrorMessage("");
    setSaveMessage("");
  }

  function openEventModal(dateKey: string, eventId: string) {
    setSelectedDateKey(dateKey);
    setSelectedEventId(eventId);
    setBulkDateKeys([]);
    setDragKeys([]);
    setIsSelecting(false);
    setErrorMessage("");
    setSaveMessage("");
  }

  function closeModal() {
    setSelectedDateKey(null);
    setSelectedEventId(null);
    setBulkDateKeys([]);
    setDragKeys([]);
    setIsSelecting(false);
    setErrorMessage("");
    setSaveMessage("");
  }

  function removeBulkDate(dateKey: string) {
    setBulkDateKeys((prev) => {
      const next = prev.filter((key) => key !== dateKey);

      if (next.length === 0) {
        setDragKeys([]);
        setIsSelecting(false);
      }

      return next;
    });

    setDragKeys(dragDateKeysRef.current.filter((key) => key !== dateKey));
  }

  function saveAttendance(eventId: string, nextStatus: string) {
    setErrorMessage("");
    setSaveMessage("");

    setLocalResponses((prevState) => {
      const nextState = { ...prevState };

      if (nextStatus) {
        nextState[eventId] = nextStatus;
      } else {
        delete nextState[eventId];
      }

      return nextState;
    });

    startTransition(async () => {
      try {
        await updateAdminCalendarAttendance(
          eventId,
          currentAdmin.id,
          nextStatus
        );
        setSaveMessage("保存しました。");
        router.refresh();
      } catch {
        setErrorMessage("保存に失敗しました。通信状態を確認してください。");
      }
    });
  }

  function saveSingleCreateEvent() {
    if (!selectedDateKey) return;

    setErrorMessage("");
    setSaveMessage("");

    if (!newTitle.trim()) {
      setErrorMessage("予定名を入力してください。");
      return;
    }

    startTransition(async () => {
      try {
        await createAdminCalendarEventFromModal({
          dateKey: selectedDateKey,
          title: newTitle,
          description: newDescription,
          location: newLocation,
          timeText: newTimeText,
          isHoliday: newIsHoliday,
          attendanceRequired: newAttendanceRequired,
          isPeriod: newIsPeriod,
          titleColor: newTitleColor,
          locationColor: newLocationColor,
          timeColor: newTimeColor,
        });

        setSaveMessage("予定を登録しました。");
        resetNewEventForm();
        closeModal();
        router.refresh();
      } catch {
        setErrorMessage("予定登録に失敗しました。");
      }
    });
  }

  function saveSelectedEventEdit() {
    if (!selectedEvent) return;

    setErrorMessage("");
    setSaveMessage("");

    if (!editTitle.trim()) {
      setErrorMessage("予定名を入力してください。");
      return;
    }

    startTransition(async () => {
      try {
        await updateAdminCalendarEventFromModal({
          eventId: selectedEvent.id,
          dateKey: editDateKey,
          title: editTitle,
          description: editDescription,
          location: editLocation,
          timeText: editTimeText,
          isHoliday: editIsHoliday,
          attendanceRequired: editAttendanceRequired,
          isPeriod: editIsPeriod,
          titleColor: editTitleColor,
          locationColor: editLocationColor,
          timeColor: editTimeColor,
        });

        setSaveMessage("予定を更新しました。");
        closeModal();
        router.refresh();
      } catch {
        setErrorMessage("予定更新に失敗しました。");
      }
    });
  }

  function saveBulkAttendance(nextStatus: string) {
    setErrorMessage("");
    setSaveMessage("");

    const targetIds = Array.from(
      new Set(bulkAnswerTargets.map(({ event }) => event.id))
    );

    if (targetIds.length === 0) {
      setErrorMessage("出欠回答できる予定が選択されていません。");
      return;
    }

    setLocalResponses((prevState) => {
      const nextState = { ...prevState };

      for (const eventId of targetIds) {
        if (nextStatus) {
          nextState[eventId] = nextStatus;
        } else {
          delete nextState[eventId];
        }
      }

      return nextState;
    });

    startTransition(async () => {
      try {
        for (const eventId of targetIds) {
          await updateAdminCalendarAttendance(
            eventId,
            currentAdmin.id,
            nextStatus
          );
        }

        setSaveMessage(`${targetIds.length}件の出欠を保存しました。`);
        router.refresh();
      } catch {
        setErrorMessage("まとめて保存に失敗しました。通信状態を確認してください。");
      }
    });
  }

  function saveBulkCreateEvents() {
    setErrorMessage("");
    setSaveMessage("");

    const dateKeys = uniqueSortedDateKeys(bulkDateKeys);

    if (dateKeys.length === 0) {
      setErrorMessage("日付が選択されていません。");
      return;
    }

    if (!bulkCreateTitle.trim()) {
      setErrorMessage("予定名を入力してください。");
      return;
    }

    startTransition(async () => {
      try {
        await createAdminCalendarEventsForDates({
          dateKeys,
          title: bulkCreateTitle,
          description: bulkCreateDescription,
          location: bulkCreateLocation,
          timeText: bulkCreateTimeText,
          isHoliday: bulkCreateIsHoliday,
          attendanceRequired: bulkCreateAttendanceRequired,
          isPeriod: bulkCreateIsPeriod,
          titleColor: "#111827",
          locationColor: "#111827",
          timeColor: "#111827",
        });

        setSaveMessage(`${dateKeys.length}日分の予定を登録しました。`);
        setBulkCreateTitle("");
        setBulkCreateLocation("");
        setBulkCreateTimeText("");
        setBulkCreateDescription("");
        setBulkCreateAttendanceRequired(true);
        setBulkCreateIsPeriod(false);
        setBulkCreateIsHoliday(false);
        closeModal();
        router.refresh();
      } catch {
        setErrorMessage("まとめて予定登録に失敗しました。");
      }
    });
  }

  function addDragDate(dateKey: string) {
    const current = dragDateKeysRef.current;

    if (current.includes(dateKey)) return;

    setDragKeys([...current, dateKey]);
  }

  function startLongPressSelection(dateKey: string) {
    if (!pointerStateRef.current.down) return;
    if (pointerStateRef.current.movedBeforeLongPress) return;

    pointerStateRef.current.selectionActive = true;

    setSelectedDateKey(null);
    setSelectedEventId(null);
    setBulkDateKeys([]);
    setDragKeys([dateKey]);
    setIsSelecting(true);
    setErrorMessage("");
    setSaveMessage("");

    if ("vibrate" in navigator) {
      navigator.vibrate(25);
    }
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    dateKey: string
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    clearLongPressTimer();

    captureElementRef.current = event.currentTarget;
    capturedPointerIdRef.current = event.pointerId;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }

    pointerStateRef.current = {
      down: true,
      selectionActive: false,
      startKey: dateKey,
      startX: event.clientX,
      startY: event.clientY,
      movedBeforeLongPress: false,
    };

    longPressTimerRef.current = window.setTimeout(() => {
      startLongPressSelection(dateKey);
    }, LONG_PRESS_MS);
  }

  function handleCalendarPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointerStateRef.current.down) return;

    const dx = event.clientX - pointerStateRef.current.startX;
    const dy = event.clientY - pointerStateRef.current.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (
      !pointerStateRef.current.selectionActive &&
      distance > SCROLL_MOVE_THRESHOLD
    ) {
      pointerStateRef.current.movedBeforeLongPress = true;
      clearLongPressTimer();
      return;
    }

    if (!pointerStateRef.current.selectionActive) return;

    event.preventDefault();
    event.stopPropagation();

    const target = document.elementFromPoint(
      event.clientX,
      event.clientY
    ) as HTMLElement | null;

    const dateKey = target
      ?.closest("[data-calendar-date-key]")
      ?.getAttribute("data-calendar-date-key");

    if (!dateKey) return;

    addDragDate(dateKey);
  }

  function handleCalendarPointerUp() {
    clearLongPressTimer();

    if (!pointerStateRef.current.down) return;

    const wasSelecting = pointerStateRef.current.selectionActive;
    const wasScrollIntent = pointerStateRef.current.movedBeforeLongPress;
    const startKey = pointerStateRef.current.startKey;

    pointerStateRef.current.down = false;
    pointerStateRef.current.selectionActive = false;
    pointerStateRef.current.movedBeforeLongPress = false;

    releasePointerCapture();

    if (wasSelecting) {
      const selectedKeys = uniqueSortedDateKeys(
        dragDateKeysRef.current.length > 0
          ? dragDateKeysRef.current
          : [startKey]
      );

      setBulkDateKeys(selectedKeys);
      setDragKeys(selectedKeys);
      setIsSelecting(false);
      return;
    }

    if (wasScrollIntent) {
      setIsSelecting(false);
      setDragKeys([]);
      return;
    }

    openDayModal(startKey);
  }

  function handleCalendarPointerCancel() {
    clearLongPressTimer();
    releasePointerCapture();

    pointerStateRef.current.down = false;
    pointerStateRef.current.selectionActive = false;
    pointerStateRef.current.movedBeforeLongPress = false;

    setIsSelecting(false);
    setDragKeys([]);
  }

  function renderNewEventForm(isHiddenMode: boolean) {
    return (
      <section
        className={
          isHiddenMode
            ? "mt-5"
            : "mt-5 rounded-lg border bg-white p-4 overflow-hidden"
        }
      >
        {isHiddenMode ? (
          <details className="rounded-lg border bg-white p-4">
            <summary className="cursor-pointer text-lg font-bold">
              予定の追加
            </summary>

            <div className="mt-4">{renderNewEventFormBody()}</div>
          </details>
        ) : (
          <>
            <h3 className="text-lg font-bold">この日付に予定を登録</h3>
            <div className="mt-4">{renderNewEventFormBody()}</div>
          </>
        )}
      </section>
    );
  }

  function renderNewEventFormBody() {
    return (
      <div className="space-y-3">
        <div className="min-w-0">
          <label className="block text-sm font-medium">予定名</label>
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            className={fieldClass}
            placeholder="例：通常練習 / 試合 / テスト期間"
          />
        </div>

        <div className="min-w-0">
          <label className="block text-sm font-medium">場所</label>
          <input
            value={newLocation}
            onChange={(event) => setNewLocation(event.target.value)}
            className={fieldClass}
            placeholder="例：第一体育館"
          />
        </div>

        <div className="min-w-0">
          <label className="block text-sm font-medium">時間</label>
          <input
            value={newTimeText}
            onChange={(event) => setNewTimeText(event.target.value)}
            className={fieldClass}
            placeholder="例：AM / PM / 終日 / 9:00-12:00"
          />
        </div>

        <div className="min-w-0">
          <label className="block text-sm font-medium">内容</label>
          <textarea
            value={newDescription}
            onChange={(event) => setNewDescription(event.target.value)}
            className={fieldClass}
            placeholder="持ち物、補足など"
          />
        </div>

        <details className="rounded bg-gray-50 p-3">
          <summary className="cursor-pointer text-sm font-bold">詳細設定</summary>

          <div className="mt-3 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newAttendanceRequired}
                onChange={(event) =>
                  setNewAttendanceRequired(event.target.checked)
                }
                disabled={newIsPeriod}
              />
              出欠回答を必要にする
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newIsPeriod}
                onChange={(event) => {
                  setNewIsPeriod(event.target.checked);

                  if (event.target.checked) {
                    setNewAttendanceRequired(false);
                  }
                }}
              />
              期間予定として下部に表示する
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newIsHoliday}
                onChange={(event) => setNewIsHoliday(event.target.checked)}
              />
              祝日扱いにする
            </label>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex items-center justify-between gap-2 rounded border bg-white px-3 py-2 text-sm">
                <span>予定</span>
                <input
                  type="color"
                  value={newTitleColor}
                  onChange={(event) => setNewTitleColor(event.target.value)}
                />
              </label>

              <label className="flex items-center justify-between gap-2 rounded border bg-white px-3 py-2 text-sm">
                <span>場所</span>
                <input
                  type="color"
                  value={newLocationColor}
                  onChange={(event) => setNewLocationColor(event.target.value)}
                />
              </label>

              <label className="flex items-center justify-between gap-2 rounded border bg-white px-3 py-2 text-sm">
                <span>時間</span>
                <input
                  type="color"
                  value={newTimeColor}
                  onChange={(event) => setNewTimeColor(event.target.value)}
                />
              </label>
            </div>
          </div>
        </details>

        <button
          type="button"
          disabled={isPending}
          onClick={saveSingleCreateEvent}
          className="w-full rounded bg-black px-4 py-3 font-bold text-white disabled:opacity-40"
        >
          予定を登録
        </button>
      </div>
    );
  }

  function renderEditEventForm() {
    if (!selectedEvent) return null;

    return (
      <details className="mt-5 rounded-lg border bg-white p-4 overflow-hidden">
        <summary className="cursor-pointer text-lg font-bold">予定の編集</summary>

        <div className="mt-4 space-y-3">
          <div className="min-w-0">
            <label className="block text-sm font-medium">日付</label>
            <input
              type="date"
              value={editDateKey}
              onChange={(event) => setEditDateKey(event.target.value)}
              className={fieldClass}
            />
          </div>

          <div className="min-w-0">
            <label className="block text-sm font-medium">予定名</label>
            <input
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              className={fieldClass}
              placeholder="例：通常練習 / 試合 / テスト期間"
            />
          </div>

          <div className="min-w-0">
            <label className="block text-sm font-medium">場所</label>
            <input
              value={editLocation}
              onChange={(event) => setEditLocation(event.target.value)}
              className={fieldClass}
              placeholder="例：第一体育館"
            />
          </div>

          <div className="min-w-0">
            <label className="block text-sm font-medium">時間</label>
            <input
              value={editTimeText}
              onChange={(event) => setEditTimeText(event.target.value)}
              className={fieldClass}
              placeholder="例：AM / PM / 終日 / 9:00-12:00"
            />
          </div>

          <div className="min-w-0">
            <label className="block text-sm font-medium">内容</label>
            <textarea
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              className={fieldClass}
              placeholder="持ち物、補足など"
            />
          </div>

          <details className="rounded bg-gray-50 p-3">
            <summary className="cursor-pointer text-sm font-bold">
              詳細設定
            </summary>

            <div className="mt-3 space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editAttendanceRequired}
                  onChange={(event) =>
                    setEditAttendanceRequired(event.target.checked)
                  }
                  disabled={editIsPeriod}
                />
                出欠回答を必要にする
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editIsPeriod}
                  onChange={(event) => {
                    setEditIsPeriod(event.target.checked);

                    if (event.target.checked) {
                      setEditAttendanceRequired(false);
                    }
                  }}
                />
                期間予定として下部に表示する
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editIsHoliday}
                  onChange={(event) => setEditIsHoliday(event.target.checked)}
                />
                祝日扱いにする
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex items-center justify-between gap-2 rounded border bg-white px-3 py-2 text-sm">
                  <span>予定</span>
                  <input
                    type="color"
                    value={editTitleColor}
                    onChange={(event) => setEditTitleColor(event.target.value)}
                  />
                </label>

                <label className="flex items-center justify-between gap-2 rounded border bg-white px-3 py-2 text-sm">
                  <span>場所</span>
                  <input
                    type="color"
                    value={editLocationColor}
                    onChange={(event) =>
                      setEditLocationColor(event.target.value)
                    }
                  />
                </label>

                <label className="flex items-center justify-between gap-2 rounded border bg-white px-3 py-2 text-sm">
                  <span>時間</span>
                  <input
                    type="color"
                    value={editTimeColor}
                    onChange={(event) => setEditTimeColor(event.target.value)}
                  />
                </label>
              </div>
            </div>
          </details>

          <button
            type="button"
            disabled={isPending}
            onClick={saveSelectedEventEdit}
            className="w-full rounded bg-black px-4 py-3 font-bold text-white disabled:opacity-40"
          >
            予定を更新
          </button>

          <a
            href={`/admin/calendar/${selectedEvent.id}`}
            className="block rounded border bg-white px-4 py-3 text-center text-sm font-bold"
          >
            詳細画面を開く
          </a>
        </div>
      </details>
    );
  }

  return (
    <>
      <section className="mt-6 rounded-lg bg-white p-2 shadow sm:mt-8 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <a
            href={`/admin/calendar?year=${prev.year}&month=${prev.month}`}
            className="rounded-full bg-gray-200 px-5 py-3 text-lg font-bold text-gray-900"
            aria-label="前月"
          >
            ◀
          </a>

          <h2 className="text-center text-2xl font-bold text-gray-900">
            {currentYear}年 {currentMonth}月
          </h2>

          <a
            href={`/admin/calendar?year=${next.year}&month=${next.month}`}
            className="rounded-full bg-gray-200 px-5 py-3 text-lg font-bold text-gray-900"
            aria-label="翌月"
          >
            ▶
          </a>
        </div>

        {isSelecting && (
          <p className="mt-3 rounded bg-yellow-100 p-2 text-center text-sm font-bold text-yellow-900">
            選択中：指を動かして日付を追加してください。
          </p>
        )}

        <div className="mt-4 overflow-hidden border border-gray-300 bg-gray-300">
          <div className="grid grid-cols-7 gap-px text-center text-sm font-bold">
            {WEEKDAYS.map((day) => (
              <div
                key={day.label}
                className={
                  day.value === 6
                    ? "bg-blue-100 p-1 text-blue-900"
                    : day.value === 0
                      ? "bg-red-100 p-1 text-red-900"
                      : "bg-gray-100 p-1 text-gray-900"
                }
              >
                {day.label}
              </div>
            ))}
          </div>

          <div
            className={
              isSelecting
                ? "mt-px grid touch-none select-none grid-cols-7 gap-px text-center"
                : "mt-px grid touch-pan-y select-none grid-cols-7 gap-px text-center"
            }
            onPointerMove={handleCalendarPointerMove}
            onPointerUp={handleCalendarPointerUp}
            onPointerCancel={handleCalendarPointerCancel}
          >
            {monthCells.map((cell, index) => {
              if (!cell) {
                return (
                  <div
                    key={`empty-${index}`}
                    className="min-h-[112px] bg-gray-50"
                  />
                );
              }

              const dayEvents = eventsByDate[cell.dateKey] ?? [];
              const normalEvents = dayEvents.filter(
                (event) => event.display_type !== "period"
              );
              const periodEvents = dayEvents.filter(
                (event) => event.display_type === "period"
              );

              const hasHolidayEvent = dayEvents.some(
                (event) => event.is_holiday
              );

              const isDraggingSelected = dragDateKeys.includes(cell.dateKey);

              const baseCellClass =
                "relative min-h-[112px] cursor-pointer p-1 text-center active:bg-yellow-100 sm:min-h-36";

              const cellClass =
                hasHolidayEvent || cell.weekday === 0
                  ? `${baseCellClass} bg-red-50`
                  : cell.weekday === 6
                    ? `${baseCellClass} bg-blue-50`
                    : `${baseCellClass} bg-white`;

              return (
                <div
                  key={cell.dateKey}
                  role="button"
                  tabIndex={0}
                  data-calendar-date-key={cell.dateKey}
                  className={cellClass}
                  style={
                    isDraggingSelected
                      ? {
                          boxShadow: "inset 0 0 0 2px #facc15",
                          backgroundColor: "#fef9c3",
                        }
                      : undefined
                  }
                  onPointerDown={(event) =>
                    handlePointerDown(event, cell.dateKey)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      openDayModal(cell.dateKey);
                    }
                  }}
                >
                  <div className="flex justify-center">
                    <span
                      className={
                        todayKey === cell.dateKey
                          ? "flex h-7 w-7 items-center justify-center rounded-full bg-black text-base font-bold text-white"
                          : "flex h-7 w-7 items-center justify-center text-base font-bold text-gray-900"
                      }
                    >
                      {cell.day}
                    </span>
                  </div>

                  <div className="mt-1 space-y-1">
                    {normalEvents.slice(0, 2).map((event) => {
                      const summary = summariesByEvent[event.id];
                      const currentStatus = localResponses[event.id] ?? "";

                      return (
                        <button
                          key={event.id}
                          type="button"
                          onPointerDown={(pointerEvent) =>
                            pointerEvent.stopPropagation()
                          }
                          onPointerUp={(pointerEvent) =>
                            pointerEvent.stopPropagation()
                          }
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            openEventModal(cell.dateKey, event.id);
                          }}
                          className="block w-full rounded bg-white px-0 py-1 text-center leading-tight shadow-sm"
                        >
                          <span
                            className="block font-bold"
                            style={calendarTextStyle(
                              event.title,
                              event.title_color
                            )}
                          >
                            {displayText(event.title)}
                          </span>

                          {event.location && (
                            <span
                              className="mt-0.5 block"
                              style={calendarTextStyle(
                                event.location,
                                event.location_color
                              )}
                            >
                              {displayText(event.location)}
                            </span>
                          )}

                          {event.time_text && (
                            <span
                              className="mt-0.5 block"
                              style={calendarTextStyle(
                                event.time_text,
                                event.time_color
                              )}
                            >
                              {displayText(event.time_text)}
                            </span>
                          )}

                          {event.attendance_required && summary && (
                            <span className="mt-0.5 block text-[9px] font-medium leading-tight text-gray-900">
                              指導者:{summary.coachAttend}
                              <br />
                              選手:{summary.playerAttend}
                            </span>
                          )}

                          {event.attendance_required && (
                            <span
                              className={`mt-1 block rounded px-1 py-0.5 text-[10px] font-bold ${statusPillClass(
                                currentStatus
                              )}`}
                            >
                              {statusCalendarLabel(currentStatus)}
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {normalEvents.length > 2 && (
                      <button
                        type="button"
                        onPointerDown={(pointerEvent) =>
                          pointerEvent.stopPropagation()
                        }
                        onPointerUp={(pointerEvent) =>
                          pointerEvent.stopPropagation()
                        }
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          openDayModal(cell.dateKey);
                        }}
                        className="block w-full rounded bg-gray-100 px-1 py-0.5 text-[9px] font-bold text-gray-700"
                      >
                        +{normalEvents.length - 2}件
                      </button>
                    )}
                  </div>

                  {periodEvents.length > 0 && (
                    <div className="mt-1 space-y-1 border-t border-gray-300 pt-1">
                      {periodEvents.slice(0, 1).map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onPointerDown={(pointerEvent) =>
                            pointerEvent.stopPropagation()
                          }
                          onPointerUp={(pointerEvent) =>
                            pointerEvent.stopPropagation()
                          }
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            openEventModal(cell.dateKey, event.id);
                          }}
                          className="block w-full rounded bg-teal-500 px-0 py-1 text-center font-bold leading-tight text-white"
                        >
                          <span
                            className="block font-bold"
                            style={calendarTextStyle(event.title, "#ffffff")}
                          >
                            {displayText(event.title)}
                          </span>
                        </button>
                      ))}

                      {periodEvents.length > 1 && (
                        <button
                          type="button"
                          onPointerDown={(pointerEvent) =>
                            pointerEvent.stopPropagation()
                          }
                          onPointerUp={(pointerEvent) =>
                            pointerEvent.stopPropagation()
                          }
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            openDayModal(cell.dateKey);
                          }}
                          className="block w-full rounded bg-teal-100 px-1 py-0.5 text-[9px] font-bold text-teal-800"
                        >
                          +{periodEvents.length - 1}件
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-bold">操作方法</h2>

        <p className="mt-2 text-sm text-gray-700">
          日付タイルをタップすると予定登録、予定をタップすると予定編集をモーダル内で行えます。
          複数日を選ぶ場合は、日付を長押ししてからドラッグしてください。
        </p>
      </section>

      {bulkDateKeys.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
          onClick={closeModal}
        >
          <div
            className="max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-md overflow-x-hidden overflow-y-auto rounded-2xl bg-white p-4 text-gray-900 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-gray-600">
                  {bulkDateKeys.length}日分を選択中
                </p>
                <h2 className="mt-1 text-xl font-bold">まとめて操作</h2>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="rounded-full bg-gray-100 px-3 py-1 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="mt-4">
              <p className="text-sm font-bold">選択日</p>

              <div className="mt-2 flex flex-wrap gap-2">
                {bulkDateKeys.map((dateKey) => (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => removeBulkDate(dateKey)}
                    className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-bold text-yellow-900"
                  >
                    {formatShortDateLabel(dateKey)} ×
                  </button>
                ))}
              </div>
            </div>

            <section className="mt-5 rounded border bg-white p-4">
              <h3 className="text-lg font-bold">選択日の予定にまとめて出欠回答</h3>

              <div className="mt-4 space-y-3">
                {bulkEvents.length === 0 ? (
                  <p className="rounded bg-gray-50 p-3 text-sm text-gray-600">
                    選択範囲に予定はありません。
                  </p>
                ) : (
                  bulkEvents.map(({ dateKey, event }) => {
                    const currentStatus = localResponses[event.id] ?? "";

                    return (
                      <div
                        key={`${dateKey}-${event.id}`}
                        className="rounded border bg-white p-3"
                      >
                        <p className="text-xs text-gray-500">
                          {formatDateLabel(dateKey)}
                        </p>

                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="font-bold">{event.title}</p>

                          {!event.attendance_required && (
                            <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                              出欠不要
                            </span>
                          )}

                          {event.attendance_required && (
                            <span
                              className={`rounded px-2 py-1 text-xs font-bold ${statusPillClass(
                                currentStatus
                              )}`}
                            >
                              {statusLongLabel(currentStatus)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-5">
                <p className="text-sm font-bold">
                  保存対象：{bulkAnswerTargets.length}件
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      disabled={isPending || bulkAnswerTargets.length === 0}
                      onClick={() => saveBulkAttendance(option.value)}
                      className="rounded border border-gray-300 bg-white px-3 py-3 text-sm font-bold text-gray-800 disabled:opacity-40"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="mt-5 rounded border bg-white p-4">
              <h3 className="text-lg font-bold">選択日にまとめて予定登録</h3>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium">予定名</label>
                  <input
                    value={bulkCreateTitle}
                    onChange={(event) => setBulkCreateTitle(event.target.value)}
                    className={fieldClass}
                    placeholder="例：通常練習 / 試合 / テスト期間"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium">場所</label>
                  <input
                    value={bulkCreateLocation}
                    onChange={(event) =>
                      setBulkCreateLocation(event.target.value)
                    }
                    className={fieldClass}
                    placeholder="例：第一体育館"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium">時間</label>
                  <input
                    value={bulkCreateTimeText}
                    onChange={(event) =>
                      setBulkCreateTimeText(event.target.value)
                    }
                    className={fieldClass}
                    placeholder="例：AM / PM / 終日 / 9:00-12:00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium">内容</label>
                  <textarea
                    value={bulkCreateDescription}
                    onChange={(event) =>
                      setBulkCreateDescription(event.target.value)
                    }
                    className={fieldClass}
                    placeholder="持ち物、補足など"
                  />
                </div>

                <div className="space-y-2 rounded bg-gray-50 p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={bulkCreateAttendanceRequired}
                      onChange={(event) =>
                        setBulkCreateAttendanceRequired(event.target.checked)
                      }
                      disabled={bulkCreateIsPeriod}
                    />
                    出欠回答を必要にする
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={bulkCreateIsPeriod}
                      onChange={(event) => {
                        setBulkCreateIsPeriod(event.target.checked);

                        if (event.target.checked) {
                          setBulkCreateAttendanceRequired(false);
                        }
                      }}
                    />
                    期間予定として下部に表示する
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={bulkCreateIsHoliday}
                      onChange={(event) =>
                        setBulkCreateIsHoliday(event.target.checked)
                      }
                    />
                    祝日扱いにする
                  </label>
                </div>

                <button
                  type="button"
                  disabled={isPending}
                  onClick={saveBulkCreateEvents}
                  className="w-full rounded bg-black px-4 py-3 font-bold text-white disabled:opacity-40"
                >
                  選択日に予定を登録
                </button>
              </div>
            </section>

            <div className="mt-4 min-h-5 text-sm">
              {isPending && <span className="text-gray-600">保存中...</span>}

              {!isPending && saveMessage && (
                <span className="text-green-700">{saveMessage}</span>
              )}

              {!isPending && errorMessage && (
                <span className="text-red-600">{errorMessage}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedDateKey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
          onClick={closeModal}
        >
          <div
            className="max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-md overflow-x-hidden overflow-y-auto rounded-2xl bg-white p-4 text-gray-900 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-gray-600">
                  {formatDateLabel(selectedDateKey)}
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  {selectedEvent ? "予定詳細" : "予定登録"}
                </h2>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="rounded-full bg-gray-100 px-3 py-1 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="mt-4">
              <p className="text-sm font-bold">この日の予定</p>

              {selectedDateEvents.length === 0 ? (
                <p className="mt-2 rounded bg-gray-50 p-3 text-sm text-gray-600">
                  この日の予定はありません。
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {selectedDateEvents.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => setSelectedEventId(event.id)}
                      className={
                        selectedEventId === event.id
                          ? "block w-full rounded border-2 border-black bg-gray-50 p-3 text-left"
                          : "block w-full rounded border bg-white p-3 text-left"
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className="font-bold"
                          style={{ color: event.title_color || "#111827" }}
                        >
                          {event.title}
                        </p>

                        {event.display_type === "period" && (
                          <span className="rounded bg-teal-100 px-2 py-1 text-xs text-teal-800">
                            期間予定
                          </span>
                        )}

                        {!event.attendance_required && (
                          <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                            出欠不要
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedEvent && selectedEvent.attendance_required && (
              <section className="mt-5 rounded-lg border bg-white p-4">
                <h3 className="text-lg font-bold">出欠回答</h3>

                <p className="mt-2 text-sm font-bold">
                  自分の回答：
                  {statusLongLabel(localResponses[selectedEvent.id] ?? "")}
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {STATUS_OPTIONS.map((option) => {
                    const currentStatus = localResponses[selectedEvent.id] ?? "";

                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          saveAttendance(selectedEvent.id, option.value)
                        }
                        className={`rounded border px-3 py-3 text-sm font-bold ${statusButtonClass(
                          option.value,
                          currentStatus
                        )}`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 rounded bg-gray-50 p-3 text-sm">
                  <p className="font-bold">集計</p>

                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded bg-green-100 p-2 text-green-800">
                      <p className="text-xs">出席</p>
                      <p className="text-lg font-bold">
                        {summariesByEvent[selectedEvent.id]?.attend ?? 0}
                      </p>
                    </div>

                    <div className="rounded bg-yellow-100 p-2 text-yellow-800">
                      <p className="text-xs">未定</p>
                      <p className="text-lg font-bold">
                        {summariesByEvent[selectedEvent.id]?.pending ?? 0}
                      </p>
                    </div>

                    <div className="rounded bg-red-100 p-2 text-red-800">
                      <p className="text-xs">欠席</p>
                      <p className="text-lg font-bold">
                        {summariesByEvent[selectedEvent.id]?.absent ?? 0}
                      </p>
                    </div>
                  </div>

                  <p className="mt-2 text-center text-sm text-gray-700">
                    指導者：
                    {summariesByEvent[selectedEvent.id]?.coachAttend ?? 0}
                    　選手：
                    {summariesByEvent[selectedEvent.id]?.playerAttend ?? 0}
                  </p>
                </div>
              </section>
            )}

            {selectedEvent && !selectedEvent.attendance_required && (
              <p className="mt-5 rounded bg-gray-50 p-3 text-sm text-gray-600">
                この予定は出欠回答不要です。
              </p>
            )}

            {selectedEvent && renderEditEventForm()}

            {selectedEvent && renderNewEventForm(true)}

            {!selectedEvent && renderNewEventForm(false)}

            <div className="mt-4 min-h-5 text-sm">
              {isPending && <span className="text-gray-600">保存中...</span>}

              {!isPending && saveMessage && (
                <span className="text-green-700">{saveMessage}</span>
              )}

              {!isPending && errorMessage && (
                <span className="text-red-600">{errorMessage}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
