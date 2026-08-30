/**
 * AIRoadtrip — Voice Input Module
 * Handles Web Speech API speech recognition for hands-free queries.
 */

class VoiceInputController {
  constructor(options = {}) {
    this.lang = options.lang || 'en-US';
    this.recognition = null;
    this.isListening = false;

    this.onStart = options.onStart || (() => {});
    this.onEnd = options.onEnd || (() => {});
    this.onResult = options.onResult || (() => {});
    this.onError = options.onError || (() => {});

    this.init();
  }

  /**
   * Check if speech recognition is supported in this browser
   */
  static isSupported() {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  /**
   * Initialize SpeechRecognition instance
   */
  init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = this.lang;
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.onStart();
    };

    this.recognition.onresult = (event) => {
      if (event.results && event.results.length > 0) {
        const transcript = event.results[0][0].transcript;
        this.onResult(transcript);
      }
    };

    this.recognition.onerror = (event) => {
      this.isListening = false;
      this.onError(event.error);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.onEnd();
    };
  }

  /**
   * Start or toggle speech recognition
   */
  toggle() {
    if (!VoiceInputController.isSupported()) {
      this.onError('unsupported');
      return;
    }

    if (!this.recognition) {
      this.init();
    }

    if (this.isListening) {
      this.stop();
    } else {
      this.start();
    }
  }

  start() {
    if (!this.recognition) return;
    try {
      this.recognition.start();
    } catch (e) {
      console.warn('Speech recognition already started or failed:', e);
    }
  }

  stop() {
    if (!this.recognition) return;
    try {
      this.recognition.stop();
    } catch (e) {
      console.warn('Error stopping speech recognition:', e);
    }
  }

  setLanguage(lang) {
    this.lang = lang;
    if (this.recognition) {
      this.recognition.lang = lang;
    }
  }

  getLanguage() {
    return this.lang;
  }
}

export default VoiceInputController;
