Signed release bundle (AAB)

- Location: `apps/twa/releases/app-release.aab`
- Built from: `apps/twa/android` using keystore at `apps/twa/android/android.keystore`

Instructions:
- Upload the AAB to Google Play Console (Internal testing track) to distribute to testers.
- Alternatively, extract APKs via `bundletool` if you need an installable APK for specific device config.

Command to extract APKs using bundletool (example):
```bash
# download bundletool.jar from https://github.com/google/bundletool
java -jar bundletool.jar build-apks --bundle=apps/twa/releases/app-release.aab --output=apps/twa/releases/app-release.apks --ks=apps/twa/android/android.keystore --ks-pass=pass:admjadmj223 --ks-key-alias=masterhubkey --key-pass=pass:admjadmj223
unzip apps/twa/releases/app-release.apks -d apps/twa/releases/apks
adb install-multiple apps/twa/releases/apks/splits/*.apk
```

Security note: do not commit `android.keystore` or `keystore.properties` to a public repository.
