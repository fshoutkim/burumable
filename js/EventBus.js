/**
 * js/EventBus.js
 * 모듈 간 디커플링(Decoupling)을 위한 비동기 이벤트 버스 시스템
 */
export default class GameEventBus {
    constructor() {
        // 이벤트별 리스너 콜백 함수를 적재할 배열 버퍼
        this.listeners = {};
    }

    /**
     * 특정 비동기 이벤트에 대한 구독 및 콜백 핸들러 등록
     * @param {string} event - 이벤트 식별자
     * @param {function} callback - 이벤트 발생 시 실행할 핸들러 함수
     */
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    /**
     * 등록된 이벤트를 트리거하고 연동된 데이터 패킷을 사운드 및 엔진 스레드로 송출
     * @param {string} event - 이벤트 식별자
     * @param {any} data - 전달할 데이터 객체 (볼륨, 파일명, 해독 런타임 등)
     */
    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => callback(data));
    }
}