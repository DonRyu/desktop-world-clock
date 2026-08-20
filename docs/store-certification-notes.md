# Notes for certification (paste into Partner Center)

Clock Widget has no main application window. This is intentional and is the whole point of
the product, so please read the steps below before testing.

WHAT HAPPENS ON LAUNCH
1. Starting the app places one or more clock cards directly on the desktop. They are
   frameless, borderless windows, so they look like desktop widgets rather than app windows.
2. A tray icon (a dark rounded card reading 12:00) appears in the notification area. All
   management happens there. The app deliberately does not appear in the taskbar.
3. No sign-in, no account, no test credentials are needed. Nothing is gated or locked.

HOW TO REACH EVERY FEATURE
- Double-click the tray icon, or double-click a widget, to open the Settings window.
- Right-click a widget for its context menu: pin, show/hide, duplicate, delete, quit.
- Hover a widget to reveal three controls: a pin (top right), a gear (top right) and a
  resize grip (bottom right). They are hidden until hover by design.
- Drag a widget to move it. Drag the bottom-right grip to resize it.
- In Settings, the eye button beside each entry in the left list hides or shows that widget.

HOW TO EXIT
Closing the Settings window does not exit the app; it keeps running in the tray, which is
the expected behaviour for a desktop widget. To exit, right-click the tray icon and choose
Quit, or use the Quit App button in the Settings window.

NETWORK AND DATA
The app makes no network requests at all. Time zone and daylight saving rules are bundled
with the application, so the clocks are correct offline. Nothing is collected or
transmitted. Settings and any background image the user picks are written only to the app's
own local data folder.

STARTUP
Start-at-login is declared through the windows.startupTask manifest extension. The user
controls it from Windows Settings, Apps, Startup. The app does not write to the registry
Run key.
