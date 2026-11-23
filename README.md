# ZenBeat PWA

Game musik ritme berbasis Progressive Web App (PWA) yang berjalan ringan dan mendukung pemutaran lagu lokal (MP3/WAV) secara offline.

## Fitur utama
- **4 tingkat kesulitan:** Mode Santuy, Mode Biasa Aja, Kebut Semalam, dan Mode WNI.
- **Lagu bawaan dan lagu sendiri:** putar lagu dari server atau dari memori perangkat tanpa kuota.
- **Sistem trial 3 hari:** pencatatan waktu lokal dan ID perangkat untuk aktivasi lisensi permanen.

## Chart otomatis
Saat sebuah lagu dipilih, ZenBeat menganalisisnya di perangkat (tanpa internet): mendeteksi ketukan dan tempo, lalu menyusun balok tap, hold, dan slide untuk tiap level.
Hasil analisis disimpan di IndexedDB sehingga lagu yang sama langsung siap pada kali berikutnya. Kode analisis ada di `chart-analyzer.js`.

## Menambah lagu bawaan
Taruh file `.mp3` di `assets/audio/songs/`. GitHub Actions (`update-songs.yml`) akan memperbarui `songs.json` otomatis.

## Efek suara
Aplikasi mencari `tap.mp3`, `perfect.mp3`, `slide.mp3`, `miss.mp3`, dan `score-tick.mp3` di `assets/audio/sfx/`.
Jika file tidak ada, aplikasi memakai suara sintesis bawaan, jadi game tetap berbunyi.

## Ikon
Ikon PWA ada di `assets/icons/` (disimpan lokal agar bisa dipasang dan dibuka offline).
