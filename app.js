async setupAudioStream(source) {
    try {
      if (source instanceof Blob) {
        this.localObjectUrl = URL.createObjectURL(source);
        this.audioEl = new Audio(this.localObjectUrl);
      } else {
        this.audioEl = new Audio(source);
      }
      this.audioEl.crossOrigin = 'anonymous';
      this.audioEl.preload = 'auto';

      // Tunggu loadedmetadata (lebih kompatibel di HP) dengan batas waktu 5 detik
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout memuat audio')), 5000);
        this.audioEl.addEventListener('loadedmetadata', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
        this.audioEl.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('File audio tidak ditemukan (404) atau format rusak'));
        }, { once: true });
        this.audioEl.load();
      });

      const trackNode = this.audioCtx.createMediaElementSource(this.audioEl);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.55;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      trackNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      this.audioEl.addEventListener('ended', () => this.finishGame(false));
      await this.audioEl.play();
      this.songDuration = this.audioEl.duration || 120;
      return true;
    } catch (err) {
      console.error('Detail error audio:', err.message, source);
      return false;
    }
  }
