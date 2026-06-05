/**
 * js/BankManager.js
 * 자산 변동, 통행료 누진 연산 및 사회복지기금 트랜잭션을 전담하는 금융 관리 클래스
 */
export default class BankManager {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.welfareFund = 0; // 사회복지기금 잔고 수치 데이터
    }

    /**
     * 현재 적립된 사회복지기금 잔고를 반환합니다.
     * @returns {number} 기금 잔액
     */
    getWelfareFund() {
        return this.welfareFund;
    }

    /**
     * 사회복지기금에 특정 자산을 가산하여 적립합니다.
     * @param {number} amount - 적립할 금액 수치
     */
    addWelfare(amount) {
        this.welfareFund += amount;
    }

    /**
     * 기금 수령 이벤트 발생 시 잔고를 제어로 완전히 비웁니다.
     */
    resetWelfare() {
        this.welfareFund = 0;
    }

    /**
     * 진입한 영토의 건축 상황에 따른 정확한 통행료를 수치 계산합니다.
     * @param {Object} tile - 해당 타일 데이터 객체
     * @returns {number} 최종 연산된 통행료 수치
     */
    calculateToll(tile) {
        // 소유주가 없거나 영토가 아닌 경우 통행료는 발생하지 않습니다.
        if (tile.type !== 'land' || tile.owner === null) return 0;
        
        // 관광 특수 구역(파란색 그룹)은 별도 건물 없이 대지 가격 그대로 청구됩니다.
        if (tile.group === 'blue') return tile.basePrice;

        // 기본 통행료 수치 산정: 대지 가격의 20%
        let toll = Math.floor(tile.basePrice * 0.20);

        // 건물 완공 개수에 따른 누진 가산 연산 처리
        if (tile.buildings === 1) {
            toll += Math.floor(tile.buildingPrice * 0.80);
        } else if (tile.buildings === 2) {
            toll += Math.floor(tile.buildingPrice * 2.00);
        } else if (tile.buildings === 3) {
            toll += Math.floor(tile.buildingPrice * 4.50);
        }
        
        return toll;
    }
}