/**
 * js/DiceEngine.js
 * 주사위 난수 생성 및 밸런스 연산을 전담하는 독립 엔진 클래스
 */
export default class DiceEngine {
    constructor(eventBus) {
        this.eventBus = eventBus;
    }

    /**
     * 2개의 주사위를 굴려 독립적인 난수를 생성하고 합산 및 더블 여부를 반환합니다.
     * @returns {Object} 주사위 연산 결과 데이터 패킷 (dice1, dice2, total, isDouble)
     */
    roll() {
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        
        return {
            dice1: d1,
            dice2: d2,
            total: d1 + d2,
            isDouble: d1 === d2
        };
    }
}