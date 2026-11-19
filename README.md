# Hopla Scan

Scanner de documents pour Android (et iPhone) : détection automatique des bords, capture automatique,
suppression des ombres, lecture du texte (OCR, PDF cherchable), carte d'identité recto-verso sur A4,
signature, lecture de QR codes. Tout reste sur le téléphone.

## Obtenir l'APK
À chaque envoi sur la branche `main`, GitHub fabrique l'APK automatiquement
(onglet **Actions**). Le fichier `hopla-scan.apk` est ensuite disponible dans **Releases**.

## Structure
- `www/` : l'application (HTML, JavaScript, moteurs OpenCV et Tesseract)
- `android/` : le projet Android (Capacitor)
- `.github/workflows/android.yml` : fabrication automatique de l'APK
