# NewBorn Helper - אפליקציית עזר להנקה

MVP קליינטי ו-Offline-first למעקב הנקה, חיתולים ודשבורד בן זוג. האפליקציה בנויה כ-PWA סטטי ב-HTML/CSS/JS, ולכן אפשר להעלות אותה כמעט לכל Static Hosting.

## מה ממומש

- Dark mode ו-RTL מלא.
- מסך בית עם כרטיס "ההאכלה הבאה", טיימר גדול וכפתורי ימין/שמאל.
- תפריט hamburger עם ניווט: בית, יומן, Sync.
- שכבת משתמשים: הנתונים נשמרים לפי משתמש מחובר או לפי מצב אורח.
- הכנה להתחברות Google דרך Google Identity Services.
- התחלה וסיום הנקה בלחיצה אחת.
- חישוב ההאכלה הבאה לפי שעת תחילת ההנקה.
- אינדיקטור מאיזה צד להתחיל בפעם הבאה.
- עצירת גרעפס/המשך הנקה.
- רישום חיתול: פיפי, קקי, גם וגם.
- סיכום יומי עם יעדי פיפי/קקי ופסי התקדמות.
- יומן אירועים עם תאריך, שעה ומשך הנקה.
- דשבורד בן זוג מקומי.
- תזכורת עדינה אחרי 5 דקות הנקה ללא עצירת גרעפס.
- Undo קצר לפעולות מהירות.
- ייצוא JSON.
- Manifest ו-Service Worker להתקנה כ-PWA.

## הרצה מקומית

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

ואז לפתוח:

```text
http://127.0.0.1:5173
```

## הכנה לפריסה

```powershell
powershell -ExecutionPolicy Bypass -File .\prepare-deploy.ps1
```

הפקודה יוצרת תיקיית `public` נקייה עם הקבצים שצריך להעלות.

## פריסה מומלצת

Production URL:

```text
https://neon-cajeta-6bc33d.netlify.app/
```

### Netlify

1. הרץ `prepare-deploy.ps1`.
2. כנס ל-Netlify.
3. בחר Add new site -> Deploy manually.
4. גרור את תיקיית `public`.

### Vercel

אפשר להעלות את הפרויקט כ-repo. אם מעלים דרך Vercel, ודא ש-Output Directory הוא:

```text
public
```

### כל אחסון סטטי אחר

העלה את התוכן של תיקיית `public` לשורש האתר.

## התחברות Google

כדי להפעיל התחברות אמיתית:

1. צור OAuth Client מסוג Web ב-Google Cloud Console.
2. הוסף Authorized JavaScript origin:

```text
http://127.0.0.1:5173
https://neon-cajeta-6bc33d.netlify.app
```

3. עדכן את `config.js`:

```js
window.LULLABY_LOG_CONFIG = {
  googleClientId: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
};
```

ללא Client ID האפליקציה עובדת במצב אורח ושומרת נתונים במכשיר.

## קבצי Stitch

הייצוא המקורי נשמר תחת:

```text
stitch_import/stitch_breastfeeding_helper_app
```

הוא לא נכלל בתיקיית `public`.

## Firebase / Firestore sync

The app supports real realtime couple sync through Firebase Auth + Cloud Firestore.

Setup:

1. Create or open a Firebase project.
2. Add a Web app and copy the Firebase config object.
3. Enable Authentication -> Sign-in method -> Google.
4. Add these Authorized domains in Firebase Authentication:

```text
localhost
127.0.0.1
neon-cajeta-6bc33d.netlify.app
```

5. Create a Cloud Firestore database.
6. Publish the rules from `firestore.rules`.
7. Update `config.js` and `public/config.js`:

```js
window.LULLABY_LOG_CONFIG = {
  productionUrl: "https://neon-cajeta-6bc33d.netlify.app",
  googleClientId: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
  geminiModel: "gemini-3.5-flash",
  appCheckSiteKey: "YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY",
  firebaseConfig: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.firebasestorage.app",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID",
  },
  supabaseUrl: "",
  supabaseAnonKey: "",
};
```

How pairing works:

- Each signed-in user keeps a personal cloud document if no partner email is configured.
- When partner emails are saved, the app creates a deterministic shared family document from the sorted email list.
- One partner can add the other partner's Google email in Settings -> Sync.
- When the second partner signs in, the app also searches Firestore for an existing family document that already includes their email.
- If automatic discovery does not find the family document, the second partner can add the first partner's email manually.
- Deletes are synced with tombstones so an old device should not restore deleted timeline entries.

## Gemini agent

The in-app assistant uses Gemini through Firebase AI Logic. It can read a privacy-filtered snapshot of the current tracker, answer questions, and use function calling to operate the app:

- Start, pause, resume, or finish a feeding.
- Log diapers, completed feedings, bottles, and pumping.
- Edit existing records and navigate between views.
- Update tracker goals, synchronize, and export.
- Ask for an explicit in-app confirmation before delete, reset, notification, or family-sharing changes.

Setup:

1. In the Firebase console for the configured project, open **Firebase AI Logic** and complete the guided setup.
2. Choose the **Gemini Developer API** provider.
3. Register the web app with **Firebase App Check** using reCAPTCHA Enterprise and enable enforcement for Firebase AI Logic.
4. Copy the public reCAPTCHA Enterprise site key into `appCheckSiteKey` in `config.js`.
5. Keep `geminiModel` set to `gemini-3.5-flash`, or change it to another model supported by Firebase AI Logic.
6. Run `prepare-deploy.ps1` before deployment so the `public` copy receives the same settings.

No Gemini secret key belongs in this repository or in browser code. Firebase AI Logic proxies model requests and App Check protects the public client from unauthorized use.

For local development, the app automatically enables App Check debug mode on `localhost` and `127.0.0.1`. Open the browser console once, copy the generated App Check debug token, and register it under **Firebase Console → App Check → Apps → Manage debug tokens**.
