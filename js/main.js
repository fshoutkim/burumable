/**
 * js/main.js
 * 분산된 개별 모듈들을 통합하고 전역 인터페이스를 바인딩하는 최종 엔트리 포인트
 */
import GameEventBus from './EventBus.js';
import AudioManager from './AudioManager.js';
import GameEngine from './GameEngine.js';

const eventBus = new GameEventBus();
const audioManager = new AudioManager(eventBus);
const engine = new GameEngine(eventBus, audioManager);

window.pressGameStart = () => {
    audioManager.initContext();
    audioManager.playIntro();
    engine.pressGameStart();
};

window.selectCharacter = (emoji) => engine.selectCharacter(emoji);
window.goBackToCharacter = () => engine.goBackToCharacter();
window.rollDiceClick = () => engine.rollDiceClick();
window.togglePause = () => engine.togglePause();

window.toggleSettingsModal = (isOpen) => {
    document.getElementById('settings-modal').style.display = isOpen ? 'flex' : 'none';
};

window.chkBgmMute = (checked) => {
    audioManager.setBgmMute(checked);
};

window.chkEffectMute = (checked) => {
    audioManager.setEffectMute(checked);
};

window.chkAllMute = (checked) => {
    audioManager.setAllMute(checked);
    document.getElementById('mute-bgm-chk').checked = checked;
    document.getElementById('mute-effect-chk').checked = checked;
    audioManager.setBgmMute(checked);
    audioManager.setEffectMute(checked);
};

window.toggleLogModal = (isOpen) => {
    const logModal = document.getElementById('log-modal') || document.getElementById('history-modal');
    if (logModal) logModal.style.display = isOpen ? 'flex' : 'none';
};

window.toggleKeyLogModal = (isOpen) => {
    const keyModal = document.getElementById('key-log-modal') || document.getElementById('golden-key-modal');
    if (keyModal) keyModal.style.display = isOpen ? 'flex' : 'none';
};

// ==========================================
// 게임 진행 시간 설정 핸들러 및 스크린 분기 제어
// ==========================================
let selectedGameTime = 20; 

window.adjustGameTime = function(amount) {
    const nextTime = selectedGameTime + amount;
    if (nextTime >= 5 && nextTime <= 60) {
        selectedGameTime = nextTime;
        document.getElementById('selected-time-display').innerText = `${selectedGameTime}분`;
    }
};

// [교정 완료] 엔진을 먼저 개시하지 않고 데이터 킵(Save) 후 시간 모달을 마운트
window.selectColor = function(colorHex) {
    engine.selectColor(colorHex);

    document.getElementById('color-box').style.display = 'none';
    document.getElementById('time-screen-box').style.display = 'block';
};

// [교정 완료] 모든 데이터 조건이 완료된 최종 확정 시점에 비로소 엔진 가동 파이프라인 개시
window.confirmGameTime = function() {
    engine.initTimer(selectedGameTime);
    
    document.getElementById('selection-screen').style.display = 'none';
    
    // 최종 메인 비즈니스 루프 가동
    engine.startGame();
};

window.goBackToColor = function() {
    document.getElementById('time-screen-box').style.display = 'none';
    document.getElementById('color-box').style.display = 'block';
};

window.addEventListener('DOMContentLoaded', () => {
    engine.init();
});