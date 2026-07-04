# אפיון טכני - Lullaby Log

## מטרה

אפליקציית PWA מהירה ו-Offline-first לתיעוד הנקות וחיתולים בזמן אמת, עם דגש על שימוש ביד אחת בלילה.

## עקרונות מוצר

- Dark Mode כברירת מחדל.
- פעולות Tap בלבד בזרימה הראשית.
- כפתורים גדולים וברורים, עם מינימום אזור לחיצה של כ-80px.
- שמירה מקומית מיידית לפני כל סנכרון ענן.
- Event log: לא מוחקים אירועים בזמן סנכרון, רק מוסיפים או מתקנים.
- RTL מלא בעברית.

## שפת UI

העיצוב מבוסס על ייצוא Google Stitch:

- רקע כהה: `#121319`.
- משטחי glassmorphism כהים עם blur.
- Primary Indigo: `#bdc2ff`.
- Success Mint: `#45dfa4`.
- Right/Accent Pink: `#ffafd3`.
- כרטיס "ההאכלה הבאה" בראש המסך.
- טיימר גדול במרכז.
- שני כפתורי צד גדולים.
- Quick Log לחיתולים בתחתית מסך הבית.
- Bottom navigation: בית, יומן, Sync.

## מודל נתונים

```ts
type Side = "left" | "right";
type DiaperType = "pee" | "poop" | "both";

interface FeedingSession {
  id: string;
  startedAt: string;
  endedAt?: string;
  side: Side;
  pauses: FeedingPause[];
  sleepyReminderShownAt?: string;
  createdBy: string;
  syncedAt?: string;
}

interface FeedingPause {
  startedAt: string;
  endedAt?: string;
  reason: "burp" | "diaper" | "sleepy" | "other";
}

interface DiaperEvent {
  id: string;
  type: DiaperType;
  createdAt: string;
  createdBy: string;
  syncedAt?: string;
}
```

## חוקי לוגיקה

- ההאכלה הבאה מחושבת לפי `startedAt + 3h`.
- הצד המומלץ הבא הוא הצד ההפוך מההנקה האחרונה.
- תזכורת תינוקת ישנונית מופיעה פעם אחת בלבד בכל סשן.
- התזכורת מופיעה אחרי 5 דקות אם אין `pauses`.
- ספירת חיתולים יומית מתבססת על היום המקומי במכשיר.
- Undo זמין לזמן קצר אחרי פעולות מהירות.

## ארכיטקטורה מומלצת לשלב הבא

```text
Angular PWA
  Core services
    FeedingService
    DiaperService
    StorageService
    SyncService
    NotificationService
  Storage
    IndexedDB local event log
  Cloud sync
    Firebase Firestore / Supabase Realtime
  Future backend
    Spring Boot only when business logic/auth/reporting require it
```

## דברים שחשוב להשלים

- עריכה ידנית: "התחילה לפני 12 דקות".
- IndexedDB במקום localStorage.
- Pairing בין בני זוג.
- Auth והרשאות.
- Conflict handling בסנכרון.
- CSV/PDF ליועצת הנקה או רופא.
- מעקב שאיבות, בקבוקים ומשקל.
