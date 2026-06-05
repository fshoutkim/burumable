/**
 * js/AudioManager.js
 * Web Audio API 기반 오디오 버퍼 관리 및 가변 레이턴시 동적 보정 모듈
 */
export default class AudioManager {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.audioCtx = null;
        this.moveBuffer = null;
        
        // 미디어 오디오 객체 정적 인스턴스화
        this.introAudio = new Audio('assets/audio/intro.mp3');
        this.introAudio.loop = true;
        this.introAudio.volume = 0.4;
        
        this.bgmAudio = new Audio('assets/audio/bgm.mp3');
        this.bgmAudio.loop = true;
        this.bgmAudio.volume = 0.3;
        
        this.fallbackAudio = new Audio('assets/audio/move.mp3');
        this.fallbackAudio.volume = 0.5;
        
        this.preMoveDelay = 150; 

        // 모듈 개별 음소거 레지스터 필드 정의
        this.bgmMuted = false;
        this.effectMuted = false;
        this.allMuted = false;

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.eventBus.on('sound:play', ({ filename, shouldAwait, resolve }) => {
            this.playDirect(filename, shouldAwait, resolve);
        });
    }

    async initContext() {
        if (this.audioCtx) return;
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const hardwareLatency = (this.audioCtx.outputLatency || 0.08) * 1000;
        this.preMoveDelay = Math.floor(hardwareLatency + 100);
        //this.preMoveDelay = 50;
        console.log(`[오디오 인프라] 하드웨어 가변 레이턴시 실시간 측정 완료: 동적 보정값 ${this.preMoveDelay}ms 적용`);
        await this.preloadMoveBuffer();
    }

    async preloadMoveBuffer() {
        try {
            const response = await fetch('assets/audio/move.mp3');
            const arrayBuffer = await response.arrayBuffer();
            this.moveBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
        } catch (error) {
            console.warn("[오디오 인프라] PCM 디코딩 실패, 레거시 컴포넌트 폴백 모드로 전환합니다.", error);
        }
    }

    playIntro() {
        if (this.allMuted || this.bgmMuted) return;
        this.introAudio.play().catch(() => {});
    }

    stopIntro() {
        if (this.introAudio) {
            this.introAudio.pause();
            this.introAudio.currentTime = 0;
        }
    }

    playBgm() {
        if (this.allMuted || this.bgmMuted) return;
        this.bgmAudio.play().catch(e => console.log("BGM 엔진 가동 지연 점검:", e));
    }

    // [음소거 바인딩 연산 인터페이스]
    setBgmMute(isMuted) {
        this.bgmMuted = isMuted;
        this.syncVolumeRegistry();
    }

    setEffectMute(isMuted) {
        this.effectMuted = isMuted;
    }

    setAllMute(isMuted) {
        this.allMuted = isMuted;
        this.syncVolumeRegistry();
    }

    syncVolumeRegistry() {
        const isMuteActive = this.allMuted || this.bgmMuted;
        if (this.bgmAudio) this.bgmAudio.volume = isMuteActive ? 0 : 0.3;
        if (this.introAudio) this.introAudio.volume = isMuteActive ? 0 : 0.4;
        
        // 음소거 해제 시점에 음악이 꺼져있다면 재가동 파이프라인 수행
        if (!isMuteActive && this.bgmAudio.paused && document.getElementById('selection-screen').style.display === 'none') {
            this.bgmAudio.play().catch(() => {});
        }
    }

    playDirect(filename, shouldAwait, resolveCallback) {
        // 효과음 음소거 상태 체크 시 즉시 콜백 반환 후 탈출
        if (this.allMuted || this.effectMuted) {
            if (resolveCallback) resolveCallback();
            return;
        }

        if (filename === 'move.mp3') {
            if (this.audioCtx && this.moveBuffer) {
                if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
                const source = this.audioCtx.createBufferSource();
                source.buffer = this.moveBuffer;
                const gainNode = this.audioCtx.createGain();
                gainNode.gain.value = 0.5;
                source.connect(gainNode);
                gainNode.connect(this.audioCtx.destination);
                source.start(0);
            } else {
                this.fallbackAudio.currentTime = 0;
                this.fallbackAudio.play().catch(() => {});
            }
            if (resolveCallback) resolveCallback();
            return;
        }

        // 특정 핵심 이벤트 오디오 수신 시 BGM 일시정지 인터랙션 인터셉트
        const isSpecialEventAudio = ['society.mp3', 'default.mp3', 'golden_key.mp3'].includes(filename);
        if (isSpecialEventAudio && this.bgmAudio && !this.bgmAudio.paused) {
            this.bgmAudio.pause();
        }

        const audio = new Audio(`assets/audio/${filename}`);
        audio.volume = 0.5;

        if (!shouldAwait) {
            audio.play().catch(() => {});
            if (resolveCallback) resolveCallback();
            return;
        }

        let isResolved = false;
        const complete = () => {
            if (!isResolved) {
                isResolved = true;
                // 특수 효과음 연출 종료 직후 BGM 복구 시퀀스 작동
                if (isSpecialEventAudio && this.bgmAudio && !this.allMuted && !this.bgmMuted) {
                    this.bgmAudio.play().catch(() => {});
                }
                if (resolveCallback) resolveCallback();
            }
        };

        audio.onended = complete;
        audio.onerror = complete;
        setTimeout(complete, 5000); 
        audio.play().catch(complete);
    }
}