# ATTENDX — QR + Geo-Tagged Attendance

Premium full-stack attendance demo for club/project selection.

## Important: Node 24 compatible
This version **does not use `better-sqlite3`**. It uses Node.js's built-in `node:sqlite`, so you do **not** need Visual Studio, C++ Build Tools, Python, or `node-gyp`.

Recommended Node.js: **22.5+ or 24.x**.

## Run on Windows
Open CMD in this `attendx` folder:

```bat
cd server
npm install
npm run dev
```

Open a second CMD window:

```bat
cd client
npm install
npm run dev
```

Then open the Vite URL shown in the terminal (normally `http://localhost:5173`).

## Demo accounts
Organizer:
- Email: `organizer@attendx.local`
- Password: `admin123`

Attendee:
- Email: `student@attendx.local`
- Password: `student123`

## Demo flow
1. Login as organizer.
2. Open the live event and show the dynamic QR.
3. The QR refreshes automatically and each token expires in 15 seconds.
4. Login as attendee on another device/browser.
5. Open **Scan QR**, allow camera + location, and scan the organizer QR.
6. Attendance is accepted only when the QR token, event time, geofence and duplicate check all pass.
7. Organizer sees the new check-in in real time through Socket.IO.
8. Open Reports and export the attendance CSV.

## Geolocation note
The seeded demo event uses SRM University coordinates. For a real demo at another venue, create an event with that venue's latitude/longitude and radius.

## Main security ideas
- Short-lived QR tokens
- Event time-window validation
- Haversine distance/geofence validation
- Duplicate attendance prevention
- Rejected-attempt audit logging
- JWT authentication
- Real-time Socket.IO updates
- CSV reporting

## Reset demo data
Stop the server and delete `server/attendx.db`, then start the server again.
