Icon & Splash Replacement

To replace the placeholder drawables with your brand assets, place image files into the following locations:

- Adaptive launcher icon:
  - `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` references `@mipmap/ic_maskable`. Replace `mipmap/ic_maskable` resources with your maskable PNGs in `res/mipmap-*/`.
- Notification icon:
  - Replace `app/src/main/res/drawable/ic_notification_icon.xml` or provide `res/drawable/ic_notification_icon.png` (24x24/48x48@1x, and higher density variants).
- Splash image:
  - Replace `app/src/main/res/drawable/splash.xml` background or provide bitmap `res/drawable/splash.png` for centered bitmap.

Quick steps:
1. Prepare PNGs for densities (mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi) and copy into respective `res/mipmap-<density>/` or `res/drawable-<density>/` folders.
2. Update `ic_maskable.xml` (or replace the referenced `@mipmap/ic_launcher`) if you use an adaptive icon foreground/background.
3. Re-run build:
```powershell
cd apps/twa/android
.\gradlew.bat assembleRelease
```
