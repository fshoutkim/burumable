/**
 * js/GameEngine.js
 * 게임 규칙, 턴 루프, UI 동기화 및 메인 비즈니스 로직을 총괄하는 코어 엔진 클래스
 */
import DiceEngine from './DiceEngine.js';
import BankManager from './BankManager.js';

export default class GameEngine {
    constructor(eventBus, audioManager) {
        this.eventBus = eventBus;
        this.audioManager = audioManager;
        
        this.diceEngine = new DiceEngine(eventBus);
        this.bankManager = new BankManager(eventBus);

        this.TOTAL_TILES = 36;
        this.INITIAL_MONEY = 5000000;
        this.SALARY = 200000;
        
        this.players = [];
        this.tiles = [];
        this.currentTurn = 0;
        this.gameTimer = null;
        this.remainingSeconds = 1200; 
        this.userDiceResolver = null;
        this.isGamePaused = false;
        this.selectedUserEmoji = '';
        this.selectedUserColor = ''; // 유저가 선택한 말 색상 버퍼

        this.MASCOT_NAMES = { '🐶': '멍멍이', '🐱': '냐옹이', '🐰': '토순이', '🐹': '찍찍이' };
        this.ALL_EMOJIS = ['🐶', '🐱', '🐰', '🐹'];
        this.TILE_EMOJIS = {};
        this.tileTemplates = [];
        this.goldenKeysPool = [];

        this.keyActions = {
            "deposit_interest": (p) => { p.money += 200000; return "200,000원 수령"; },
            "scholarship": (p) => { p.money += 150000; return "150,000원 수령"; },
            "income_tax": (p) => { p.money -= 150000; this.bankManager.addWelfare(150000); return "150,000원 세금 차감"; },
            "building_repair": (p) => { p.money -= 100000; this.bankManager.addWelfare(100000); return "100,000원 기금 귀속"; },
            "go_to_island": async (p) => { p.position = 9; p.islandTurns = 3; return "무인도 수감 조치"; },
            "go_to_start": async (p) => { p.position = 0; p.lap++; p.money += this.SALARY; return "출발지 이동 및 월급 지급"; },
            "go_to_space": async (p) => { if(p.position > 27) { p.lap++; p.money += this.SALARY; } p.position = 27; p.spaceWait = true; return "우주정거장 이송"; },
            "traffic_fine": (p) => { p.money -= 50000; this.bankManager.addWelfare(50000); return "벌금 50,000원 적립"; },
            "warp_seoul": async (p) => { p.position = 35; return "서울 영토 진입"; },
            "lottery": (p) => { p.money += 300000; return "300,000원 복권 상금"; }
        };
    }

    triggerAudio(filename, shouldAwait) {
        return new Promise((resolve) => {
            this.eventBus.emit('sound:play', { filename, shouldAwait, resolve });
        });
    }

    async init() {
        try {
            const response = await fetch('data.json');
            const config = await response.json();
            
            this.TOTAL_TILES = config.TOTAL_TILES;
            this.INITIAL_MONEY = config.INITIAL_MONEY;
            this.SALARY = config.SALARY;
            this.ALL_EMOJIS = config.ALL_EMOJIS;
            this.MASCOT_NAMES = config.MASCOT_NAMES;
            this.TILE_EMOJIS = config.TILE_EMOJIS;
            this.tileTemplates = config.tileTemplates;
            this.goldenKeysPool = config.goldenKeysPool;

            document.getElementById('turn-info').innerText = "대기 중...";
        } catch (error) {
            console.error("[코어 엔진] JSON 환경 설정 데이터 로드 실패:", error);
        }
    }

    /**
     * 보드판 배치 구조 물리 DOM 동적 생성 (국기 이미지 및 특수 이모지 워터마크 하이브리드 버전)
     */
    setupInitialBoard() {
        const boardEl = document.getElementById('board');
        this.tiles = []; // 세션 재시작 시 가변 버퍼 초기화 안전 조치
        
        this.tileTemplates.forEach((t) => {
            const pos = this.getGridCoords(t.id);
            const tileDiv = document.createElement('div');
            tileDiv.id = `tile-${t.id}`;
            tileDiv.className = `tile`;
            
            if (t.type === 'start') tileDiv.classList.add('tile-start');
            else if (t.type === 'island') tileDiv.classList.add('tile-island');
            else if (t.type === 'space') tileDiv.classList.add('tile-space');
            else if (t.type === 'welfare') tileDiv.classList.add('tile-welfare');
            else if (t.type === 'tax') tileDiv.classList.add('tile-tax');
            else if (t.type === 'key') tileDiv.classList.add('tile-key');
            
            tileDiv.style.gridRow = pos.r;
            tileDiv.style.gridColumn = pos.c;

            let groupClass = t.group ? String(t.group).toLowerCase() : '';
            
            // [물리 구역 컬러 동기화] 인덱스를 역추적하여 상단 및 우측 라인의 화이트 누락 현상을 원천 방어
            if (t.id >= 19 && t.id <= 27) {
                groupClass = 'blue'; 
            } else if (t.id >= 28 && t.id <= 35) {
                groupClass = 'magenta'; 
            }

            let colorBarHTML = t.group !== 'special' ? `<div class="color-bar g-${groupClass}"></div>` : '';
            let textPrice = t.type === 'land' ? (t.basePrice / 10000) + '만' : '';
            
            // data.json의 TILE_EMOJIS 뱅크로부터 고유 문자열 및 이모지 데이터 로드
            let rawFlagCode = this.TILE_EMOJIS[t.id] || ''; 
            let flagHTML = '';
            let specialWatermarkHTML = ''; // 특수 그룹 이모지 워터마크 보관 버퍼 신설
            let countryKey = '';

            // [공학적 유니코드 디코더] 국기 이모지를 로컬 파일명 문자로 역산 변환
            if (t.id === 35) {
                countryKey = 'kr'; // 왕관 이모지로 매핑된 서울 구역 예외 제어
            } else if (rawFlagCode) {
                const codePoints = [...rawFlagCode].map(c => c.codePointAt(0));
                if (codePoints.length >= 2 && codePoints[0] >= 0x1F1E6 && codePoints[0] <= 0x1F1FF) {
                    const char1 = String.fromCharCode(codePoints[0] - 0x1F1E6 + 97); 
                    const char2 = String.fromCharCode(codePoints[1] - 0x1F1E6 + 97);
                    countryKey = char1 + char2;
                }
            }

            const validCountries = ['ar', 'br', 'au', 'ca', 'de', 'ch', 'se', 'dk', 'gr', 'tr', 'eg', 'sg', 'ph', 'hk', 'tw', 'jp', 'fr', 'it', 'gb', 'us', 'pt', 'es'];
            
            if (countryKey && validCountries.includes(countryKey)) {
                // 1. 일반 국가 타일인 경우: 로컬 국기 이미지 매립
                flagHTML = `<img src="./images/flags/${countryKey}.png" class="tile-flag-watermark" alt="">`;
            } else if (rawFlagCode) {
                // 2. 특수 그룹 및 이미지 없는 관광지 타일인 경우: 오리지널 이모지를 반투명 텍스처로 주입
                specialWatermarkHTML = `<div class="tile-special-watermark">${rawFlagCode}</div>`;
            }

            // [레이어 구조 동기화] 이미지와 특수 워터마크 레이어를 텍스트 컨텐츠 하위에 선제 배치
            tileDiv.innerHTML = `
                ${colorBarHTML}
                ${flagHTML}
                ${specialWatermarkHTML}
                <div class="tile-name">${t.name}</div>
                <div class="owner-badge" id="owner-${t.id}"></div>
                <div class="buildings-indicator" id="build-${t.id}"></div>
                <div class="tile-info" id="price-${t.id}">${textPrice}</div>
                <div class="player-tokens" id="tokens-${t.id}"></div>
            `;
            boardEl.appendChild(tileDiv);
            this.tiles.push({ ...t, owner: null, buildings: 0, buildingTypes: [], buildingPrice: Math.floor(t.basePrice * 0.8) });
        });
    }

    /**
     * 경기 세션 가동 및 참가자 인스턴스 레이아웃 제어
     */
    startGame() {
        this.audioManager.stopIntro();
        this.audioManager.playBgm(); 
        this.setupInitialBoard();

        let availableColors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'];
        availableColors = availableColors.filter(c => c !== this.selectedUserColor);

        let pNo = 1;
        this.players.push({ 
            id: 0, emoji: this.selectedUserEmoji, name: `${this.MASCOT_NAMES[this.selectedUserEmoji]}(USER)`, 
            color: this.selectedUserColor, pNum: pNo++, money: this.INITIAL_MONEY, position: 0, lap: 0, 
            islandTurns: 0, isBankrupt: false, spaceWait: false, isMoving: false 
        });
        
        this.ALL_EMOJIS.forEach(emoji => {
            if (emoji !== this.selectedUserEmoji) {
                this.players.push({ 
                    id: pNo - 1, emoji: emoji, name: `${this.MASCOT_NAMES[emoji]}`, 
                    color: availableColors.shift(), pNum: pNo++, money: this.INITIAL_MONEY, position: 0, lap: 0, 
                    islandTurns: 0, isBankrupt: false, spaceWait: false, isMoving: false 
                });
            }
        });

        document.querySelectorAll('.token').forEach(el => el.remove());
        this.players.forEach(p => {
            const tokenSpan = document.createElement('span');
            tokenSpan.id = `token-player-${p.id}`;
            tokenSpan.className = 'token';
            tokenSpan.style.backgroundColor = p.color;
            tokenSpan.innerText = `✈️${p.pNum}`;
            document.getElementById('board').appendChild(tokenSpan);
        });

        this.systemAnnounce("클래스 모듈화 코어 엔진 가동 완료. 세션을 개시합니다.", "#2ecc71");
        this.startCountdownTimer();
        this.updateUI();
        this.runCentralGameLoop();
    }

    /**
     * [구조 혁신 버전] 사운드 오디오 락 분리 및 순수 비주얼 연속 이동 동기화 구조
     */
    async movePlayerSteps(player, steps) {
        player.isMoving = true; 
        for (let i = 0; i < steps; i++) {
            await this.checkPause(); 

            // 대기 시간 없이 즉시 다음 칸으로 좌표를 전진시키고 UI를 전격 동기화합니다.
            player.position = (player.position + 1) % this.TOTAL_TILES;

            if (player.position === 0) {
                player.lap++;
                player.money += this.SALARY;
                this.systemAnnounce(`[출발지] ${player.name} 완주 월급 200,000원 획득.`, '#2ecc71');
            }

            // 팝업이 닫히자마자 첫 프레임에서 이 구문이 곧바로 컴파일되므로 말이 지체 없이 즉각 미끄러집니다.
            this.updateUI();
            
            // 한 칸 이동당 총 체류 주기(400ms)만큼만 깔끔하게 대기하며 이동 중 잦은 효과음을 소거하여 부하를 줄입니디.
            await new Promise(resolve => setTimeout(resolve, 400)); 
        }
        player.isMoving = false; 
        this.updateUI();

        // [공학적 안착음 결정] 최종 목적지에 완벽하게 도달하여 안착했을 때 기존 이동 효과음(move.mp3)을 단 1회 재생합니다.
        this.triggerAudio('move.mp3', false);
    }

    async executeTurn(player) {
        const rollResult = this.diceEngine.roll();
        document.getElementById('dice-display').innerText = `${this.getDiceEmoji(rollResult.dice1)} ${this.getDiceEmoji(rollResult.dice2)} (${rollResult.total})`;

        if (player.islandTurns > 0) {
            this.systemAnnounce(`${player.name} 무인도 탈출 자격 심사 개시.`);
            await this.showLargeDiceOverlay(this.getDiceEmoji(rollResult.dice1), this.getDiceEmoji(rollResult.dice2), rollResult.dice1, rollResult.dice2, player, rollResult.isDouble);

            if (rollResult.isDouble) {
                player.islandTurns = 0;
                this.systemAnnounce(`🎉 ${player.name} 주사위 더블 일치! 무인도를 전격 탈출합니다.`, "#2ecc71");
                return false; 
            } else {
                player.islandTurns--;
                this.systemAnnounce("탈출 실패 (남은 대기 기한: " + player.islandTurns + "턴)");
                return false;
            }
        }

        await this.showLargeDiceOverlay(this.getDiceEmoji(rollResult.dice1), this.getDiceEmoji(rollResult.dice2), rollResult.dice1, rollResult.dice2, player, rollResult.isDouble);
        await this.movePlayerSteps(player, rollResult.total);
        
        if (!player.isBankrupt) {
            await this.processTileAction(player);
        }

        return rollResult.isDouble; 
    }

    async processTileAction(player) {
        if (player.isBankrupt) return;

        let currentTile = this.tiles[player.position];
        this.systemAnnounce(`${player.name} -> [ ${currentTile.name} ] 부지 착륙.`);

        if (currentTile.type === 'start') return;

        if (currentTile.type === 'island') {
            player.islandTurns = 3;
            this.systemAnnounce("🚨 무인도 조난 고립 조치! 탈출을 위해 주사위 더블 신호가 요구됩니다.", "#e74c3c");
            return;
        }

        if (currentTile.type === 'space') {
            player.spaceWait = true;
            this.systemAnnounce("🚀 우주정거장 진입 관제 대기! 다음 차례에 타겟 타일로 초고속 비행합니다.", "#9b59b6");
            return;
        }

        if (currentTile.type === 'welfare') {
            const currentFund = this.bankManager.getWelfareFund();
            if (currentFund > 0) {
                this.systemAnnounce(`💰 기금 잔고 계좌 수령 이체 완료: ${currentFund.toLocaleString()}원 인도 수령!`, "#2ecc71");
                player.money += currentFund;
                this.bankManager.resetWelfare();
            }
            return;
        }

        if (currentTile.type === 'tax') {
            const taxAmount = 200000;
            player.money -= taxAmount;
            this.bankManager.addWelfare(taxAmount);
            
            let taxMsgHTML = `
                <div style="font-size:3.5rem; margin-bottom:10px;">💸</div>
                <div style="color:#f1c40f;">사회복지기금 과세 발동</div>
                <div style="font-size:1.2rem; margin-top:20px; color:#bdc3c7;">
                    <b style="color:${player.color}">${player.name}</b>님이 기금 <b>200,000원</b>을 예치했습니다.
                </div>
            `;

            const audioPromise = this.triggerAudio('society.mp3', true);
            await this.showFadePopup(taxMsgHTML, audioPromise);

            if (player.money <= 0) {
                await this.executeBankruptcy(player, null);
            }
            return;
        }

        if (currentTile.type === 'key') {
            await this.triggerGoldenKey(player);
            return;
        }

        if (currentTile.type === 'land') {
            // [논리 제어 스위치 주입] 1바퀴 완주 전(lap 변수가 0인 상태)에는 매입 시퀀스 자체를 전면 차단합니다.
            if (player.lap === 0) {
                this.systemAnnounce(`[매입 제한] ${player.name} -> 아직 1바퀴를 완주하지 못해 영토를 매입할 수 없습니다.`, "#7f8c8d");
                return;
            }
            if (currentTile.owner === null) {
                let buyDecision = false;
                if (player.id === 0) {
                    buyDecision = await this.askUserChoice(`영토 매입 (${currentTile.basePrice.toLocaleString()}원)`, '매입 승인', '보류하기');
                } else {
                    buyDecision = player.money >= currentTile.basePrice; 
                }

                if (buyDecision) {
                    player.money -= currentTile.basePrice;
                    currentTile.owner = player.id;
                    this.systemAnnounce(`[영토 등기] ${player.name} -> [ ${currentTile.name} ] 자산 편입 완료.`, "#3498db");
                }
            }
            else if (currentTile.owner === player.id) {
                if (currentTile.id >= 19 && currentTile.id <= 27) { // 36칸 보드판 기준 상단 블루라인 인덱스 감지
                    this.systemAnnounce(`[특수 구역] ${currentTile.name} 부지에는 추가 시설 축조가 영구 금지됩니다.`, "#7f8c8d");
                    return;
                }

                if (player.lap === 0 || currentTile.buildings >= 3) return;
                if (!currentTile.buildingTypes) currentTile.buildingTypes = [];

                let chosenType = null;
                if (player.id === 0) {
                    chosenType = await this.askBuildingChoice(currentTile);
                } else {
                    if (player.money >= currentTile.buildingPrice) {
                        const aiTypes = ['별장', '빌딩', '호텔'];
                        chosenType = aiTypes[currentTile.buildings] || '별장';
                    }
                }

                if (chosenType) {
                    player.money -= currentTile.buildingPrice;
                    currentTile.buildings++;
                    currentTile.buildingTypes.push(chosenType);
                    this.systemAnnounce(`[건물 완공] ${player.name} -> [ ${currentTile.name} ]에 ${chosenType} 시공 완료.`, "#f1c40f");
                } else {
                    this.systemAnnounce(`${player.name} 유저가 추가 증축 제안을 보류했습니다.`);
                }
            }
            else if (currentTile.owner !== player.id) {
                let ownerPlayer = this.players[currentTile.owner];
                let totalToll = this.bankManager.calculateToll(currentTile);

                this.systemAnnounce(`[사유지 진입] 통행료 청구: ${totalToll.toLocaleString()}원 (지분 소유주: ${ownerPlayer.name})`, "#e74c3c");
                
                if (player.money - totalToll < 0) {
                    await this.executeBankruptcy(player, ownerPlayer);
                } else {
                    player.money -= totalToll;
                    ownerPlayer.money += totalToll;
                    this.systemAnnounce("[트랜잭션 종결] 영토 임대차 통행료 계좌 정산 완료.", "#ff6b6b");
                }
            }
        }
        await new Promise(r => setTimeout(r, 800)); 
        await this.checkPause();
        this.updateUI(); 
    }

    async executeBankruptcy(bankruptPlayer, creditorPlayer) {
        bankruptPlayer.isBankrupt = true;

        if (bankruptPlayer.id === 0) {
            this.clearLiquidatedAssets(bankruptPlayer);
            clearInterval(this.gameTimer);
            document.getElementById('result-title').innerText = "💀 플레이어 파산 게임 종료 💀";
            await this.triggerTimeOutEndGame();
            return;
        } else {
            let bankruptPopupHTML = `
                <div style="font-size:4.5rem; margin-bottom:15px;">💀</div>
                <div style="color:#e74c3c; font-size:2.2rem; font-weight:900; letter-spacing:2px;">파산 통보</div>
                <div style="font-size:1.5rem; margin-top:25px; line-height:1.6; color:#ffffff;">
                    <b style="color:${bankruptPlayer.color}; text-shadow:1px 1px 2px rgba(0,0,0,0.5);">${bankruptPlayer.name}</b> 유저가 자금 소진으로 <br>
                    <span style="color:#f1c40f; font-weight:bold;">최종 파산</span> 하였습니다.
                </div>
            `;
            
            const popupPromise = this.showFadePopup(bankruptPopupHTML);
            const audioPromise = this.triggerAudio('default.mp3', true);
            await Promise.all([popupPromise, audioPromise]);
        }

        let totalPropertyLiquidated = 0;
        this.tiles.forEach(t => {
            if (t.owner === bankruptPlayer.id) {
                totalPropertyLiquidated += t.basePrice + (t.buildings * t.buildingPrice);
                t.owner = null;
                t.buildings = 0;
                t.buildingTypes = []; 
            }
        });

        let finalAssetSum = bankruptPlayer.money + totalPropertyLiquidated;
        bankruptPlayer.money = 0;

        this.systemAnnounce(`💀 청산 집행 결론: ${bankruptPlayer.name} 총액 자산 ${finalAssetSum.toLocaleString()}원 최종 말소 및 법정 증발`, "#c0392b");

        if (creditorPlayer !== null) {
            let creditorShare = Math.floor(finalAssetSum * 0.7);
            creditorPlayer.money += creditorShare;
            this.systemAnnounce(`[배분비율 70/30 법안] 청산 가치 가용 자산의 70%인 ${creditorShare.toLocaleString()}원이 채권자 계좌로 배당 이체되었습니다.`, "#fdcb6e");
        }
        
        this.updateUI();

        let actives = this.players.filter(p => !p.isBankrupt);
        if (actives.length === 1) {
            clearInterval(this.gameTimer);
            document.getElementById('result-title').innerText = "🏆 단독 생존 독점 종료 🏆";
            await this.triggerTimeOutEndGame();
            return;
        }
    }

    clearLiquidatedAssets(player) {
        this.tiles.forEach(t => {
            if (t.owner === player.id) {
                t.owner = null;
                t.buildings = 0;
                t.buildingTypes = []; 
            }
        });
        player.money = 0;
    }

    async triggerGoldenKey(player) {
        await this.triggerAudio('golden_key.mp3', true); 

        const card = this.goldenKeysPool[Math.floor(Math.random() * this.goldenKeysPool.length)];
        const actionFn = this.keyActions[card.actionId];
        const resultMsg = await actionFn(player);
        
        let keyPopupHTML = `
            <div style="font-size:3.5rem; margin-bottom:10px;">🔑</div>
            <div style="color:#f1c40f; margin-bottom:15px;">황금열쇠 발동</div>
            <div style="font-size:1.3rem; line-height:1.5;">${card.text}</div>
            <div style="font-size:1rem; margin-top:25px; color:#bdc3c7;">지령 대상: <b style="color:${player.color}">${player.name}</b></div>
        `;
        
        await this.showFadePopup(keyPopupHTML);
        this.recordKeyLog(player, card.text, resultMsg);
        this.systemAnnounce(`[지령 결과] -> ${resultMsg}`, "#f39c12");
        
        if (player.money <= 0 && !player.isBankrupt) {
            await this.executeBankruptcy(player, null);
        }
        this.updateUI();
    }

    async runCentralGameLoop() {
        while (true) {
            await this.checkPause(); 

            if (this.players[0] && this.players[0].isBankrupt) {
                clearInterval(this.gameTimer);
                document.getElementById('result-title').innerText = "💀 플레이어 파산 게임 종료 💀";
                await this.triggerTimeOutEndGame();
                return;
            }

            let actives = this.players.filter(p => !p.isBankrupt);
            if (actives.length === 1) {
                clearInterval(this.gameTimer);
                document.getElementById('result-title').innerText = "🏆 단독 생존 독점 종료 🏆";
                await this.triggerTimeOutEndGame();
                return;
            }

            let p = this.players[this.currentTurn];
            if (p.isBankrupt) {
                this.currentTurn = (this.currentTurn + 1) % 4;
                await new Promise(r => setTimeout(r, 50)); 
                continue;
            }

            if (p.spaceWait) {
                document.getElementById('turn-info').innerText = `현재 차례: ${p.name} (우주 관제 정거장 도킹 중)`;
                let targetTileId = 27;
                if (p.id === 0) {
                    targetTileId = await this.askSpaceDestination();
                } else {
                    await new Promise(r => setTimeout(r, 1500)); 
                    await this.checkPause();
                    targetTileId = this.aiChooseSpaceDestination(p);
                }

                if (targetTileId < p.position) {
                    p.lap++;
                    p.money += this.SALARY;
                    this.systemAnnounce(`🚀 [우주 비행] 출발지 궤도를 통과하여 완주 월급 ${this.SALARY.toLocaleString()}원이 정상 이체되었습니다.`, '#2ecc71');
                }

                p.position = targetTileId;
                p.spaceWait = false; 
                
                this.updateUI(p.id); 
                await new Promise(r => setTimeout(r, 300));
                this.updateUI(); 
                
                await new Promise(r => setTimeout(r, 500));
                await this.checkPause();
                
                if (!p.isBankrupt) {
                    await this.processTileAction(p);
                }
                
                this.currentTurn = (this.currentTurn + 1) % 4;
                this.updateUI();
                continue;
            }

            document.getElementById('turn-info').innerText = `현재 차례: ${p.name}`;

            if (p.id === 0) {
                document.getElementById('dice-btn').disabled = false;
                await new Promise(resolve => { this.userDiceResolver = resolve; });
                
                let rolledDouble = await this.executeTurn(p);
                if (rolledDouble && p.islandTurns === 0 && !p.isBankrupt && !p.spaceWait) {
                    this.systemAnnounce("[연속 찬스] 주사위 더블 일치로 연속 유저 제어권을 확보합니다.", "#f1c40f");
                    this.updateUI();
                    continue; 
                }
            } else {
                document.getElementById('dice-btn').disabled = true;
                await new Promise(resolve => setTimeout(resolve, 1000)); 
                await this.checkPause(); 
                
                let rolledDouble = await this.executeTurn(p);
                if (rolledDouble && p.islandTurns === 0 && !p.isBankrupt && !p.spaceWait) {
                    this.systemAnnounce("[연속 찬스] AI 난수 더블 판정으로 연쇄 제어 주기를 가동합니다.", "#f1c40f");
                    this.updateUI();
                    continue;
                }
            }

            this.currentTurn = (this.currentTurn + 1) % 4;
            this.updateUI();
        }
    }

    startCountdownTimer() {
        if(this.gameTimer) clearInterval(this.gameTimer); // 타이머 중복 생성 전면 제어
        this.gameTimer = setInterval(async () => {
            this.remainingSeconds--;
            if (this.remainingSeconds <= 0) {
                clearInterval(this.gameTimer);
                await this.triggerTimeOutEndGame();
                return;
            }
            const mins = Math.floor(this.remainingSeconds / 60);
            const secs = this.remainingSeconds % 60;
            document.getElementById('timer-display').innerText = `남은 시간: ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }, 1000);
    }

    updateUI(instantPlayerId = null) {
        document.getElementById('welfare-pool').innerText = `사회복지기금 잔고: ${this.bankManager.getWelfareFund().toLocaleString()}원`;

        for (let i = 0; i < this.TOTAL_TILES; i++) {
            const tileEl = document.getElementById(`tile-${i}`);
            if (!tileEl) continue; 
            
            const buildEl = document.getElementById(`build-${i}`);
            if (buildEl && this.tiles[i].type === 'land') {
                if (this.tiles[i].buildingTypes && this.tiles[i].buildingTypes.length > 0) {
                    buildEl.innerText = this.tiles[i].buildingTypes.map(b => b === '별장' ? '🏡' : (b === '빌딩' ? '🏢' : '🏨')).join('');
                } else {
                    buildEl.innerText = this.tiles[i].buildings > 0 ? '🏠'.repeat(this.tiles[i].buildings) : '';
                }
            }

            const ownerEl = document.getElementById('owner-' + i);
            const tileNameEl = tileEl.querySelector('.tile-name');
            const tileInfoEl = tileEl.querySelector('.tile-info');

            if (this.tiles[i].owner !== null && this.players[this.tiles[i].owner]) {
                if (ownerEl) ownerEl.innerText = this.players[this.tiles[i].owner].emoji;
                if (this.tiles[i].type === 'land') {
                    tileEl.style.setProperty("background", this.players[this.tiles[i].owner].color, "important");
                    if(tileNameEl) {
                        tileNameEl.style.color = '#ffffff';
                        tileNameEl.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)';
                    }
                    if(tileInfoEl) {
                        tileInfoEl.style.color = '#f1f2f6';
                    }
                }
            } else {
                if (ownerEl) ownerEl.innerText = '';
                if (this.tiles[i].type === 'land') {
                    tileEl.style.background = ''; 
                    if(tileNameEl) {
                        tileNameEl.style.color = '';
                        tileNameEl.style.textShadow = '';
                    }
                    if(tileInfoEl) {
                        tileInfoEl.style.color = '';
                    }
                }
            }
        }

        this.players.forEach(p => {
            const tokenEl = document.getElementById(`token-player-${p.id}`);
            if (!tokenEl) return;
            
            if (p.isBankrupt) {
                tokenEl.style.display = 'none';
                return;
            }
            
            tokenEl.style.display = 'inline-block';
            
            if (instantPlayerId === p.id) {
                tokenEl.style.transition = 'none';
            } else {
                tokenEl.style.transition = '';
            }
            
            if (p.isMoving) tokenEl.classList.add('moving');
            else tokenEl.classList.remove('moving');
            
            const playersOnSameTile = this.players.filter(pl => pl.position === p.position && !pl.isBankrupt);
            const idx = playersOnSameTile.indexOf(p);
            
            const tileEl = document.getElementById(`tile-${p.position}`);
            if (tileEl) {
                const baseLeft = tileEl.offsetLeft;
                const baseTop = tileEl.offsetTop;
                const offsetX = (idx % 2) * 28 + 18;
                const offsetY = Math.floor(idx / 2) * 28 + 45;
                
                tokenEl.style.left = `${baseLeft + offsetX}px`;
                tokenEl.style.top = `${baseTop + offsetY}px`;
            }
        });

        const tbody = document.getElementById('player-status-rows');
        if (tbody) {
            tbody.innerHTML = '';
            this.players.forEach(p => {
                const tr = document.createElement('tr');
                if (p.isBankrupt) tr.className = 'bankrupt';
                let statusText = p.isBankrupt ? '파산 격리' : (p.islandTurns > 0 ? `무인도 (${p.islandTurns}턴)` : (p.spaceWait ? '우주 대기' : '정상 운항'));

                tr.innerHTML = `
                    <td><span style="padding:2px 5px; border-radius:3px; background:${p.color}; color:white; font-size:0.7rem;">✈️${p.pNum}</span> ${p.name}</td>
                    <td><b>${p.money.toLocaleString()}</b> 원</td>
                    <td>${this.tiles[p.position] ? this.tiles[p.position].name : '출발지'}</td>
                    <td>${p.lap} 바퀴</td>
                    <td>${statusText}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    async triggerTimeOutEndGame() {
        clearInterval(this.gameTimer);
        document.getElementById('dice-btn').disabled = true;

        let rankingData = this.players.map(p => {
            if (p.isBankrupt) return { name: p.name, totalValue: -1, status: "파산 격리" };
            let landSum = 0, buildingSum = 0;
            this.tiles.forEach(t => {
                if (t.owner === p.id) {
                    landSum += t.basePrice;
                    buildingSum += (t.buildings * t.buildingPrice) * 0.5; 
                }
            });
            return { name: p.name, totalValue: p.money + landSum + buildingSum, status: "정상 완주" };
        });

        rankingData.sort((a, b) => b.totalValue - a.totalValue);

        const userMascotName = `${this.MASCOT_NAMES[this.selectedUserEmoji]}(USER)`;
        const isUserWinner = (rankingData[0].name === userMascotName && rankingData[0].totalValue !== -1);

        if (isUserWinner) {
            this.triggerAudio('player_win.mp3', false);
        } else {
            this.triggerAudio('player_lose.mp3', false);
        }

        const resultTbody = document.getElementById('result-rows');
        resultTbody.innerHTML = '';
        rankingData.forEach((res, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><b>${index + 1}등</b></td>
                <td>${res.name}</td>
                <td>${res.totalValue === -1 ? '0' : res.totalValue.toLocaleString()} 원</td>
                <td><span style="color:${res.totalValue === -1 ? '#e74c3c' : '#2ecc71'}">${res.status}</span></td>
            `;
            resultTbody.appendChild(tr);
        });

        document.getElementById('result-overlay').style.display = 'flex';
    }

    systemAnnounce(msg, color = '#ecf0f1') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast-popup';
        if(color !== '#ecf0f1') toast.style.borderColor = color;
        toast.innerText = msg;
        container.appendChild(toast);
        
        setTimeout(() => {
            if (toast && toast.parentNode) {
                toast.remove();
            }
        }, 3000);
        
        const historyArea = document.getElementById('modal-log-area');
        const logRow = document.createElement('div');
        logRow.className = 'log-entry';
        logRow.style.color = color;
        logRow.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
        historyArea.appendChild(logRow);
        historyArea.scrollTop = historyArea.scrollHeight;
    }

    recordKeyLog(player, text, resultMsg) {
        const keyArea = document.getElementById('modal-key-log-area');
        const logRow = document.createElement('div');
        logRow.className = 'log-entry';
        logRow.style.color = '#f1c40f';
        logRow.innerHTML = `[${new Date().toLocaleTimeString()}] <b>${player.name}</b>: ${text} <br><span style="color:#bdc3c7;">-> ${resultMsg}</span>`;
        keyArea.appendChild(logRow);
        keyArea.scrollTop = keyArea.scrollHeight;
    }

    async showFadePopup(htmlMsg, condition = 1200) {
        const el = document.getElementById('center-fade-popup');
        el.innerHTML = htmlMsg;
        el.style.display = 'block';
        el.style.transition = 'none';
        el.style.opacity = '1';
        void el.offsetWidth; 
        el.style.transition = 'opacity 1.5s ease-out';
        
        if (condition instanceof Promise) {
            await condition;
        } else {
            await new Promise(resolve => setTimeout(resolve, condition));
        }
        
        await this.checkPause(); 
        el.style.opacity = '0';
        await new Promise(resolve => setTimeout(resolve, 1500));
        el.style.display = 'none';
    }

    async showLargeDiceOverlay(e1, e2, num1, num2, player, isDouble) {
        const overlay = document.getElementById('dice-overlay');
        document.getElementById('dice-popup-player').innerText = `${player.name}의 주사위 가동`;
        document.getElementById('dice-cube-1').innerText = e1;
        document.getElementById('dice-cube-2').innerText = e2;
        document.getElementById('dice-popup-number').innerText = `총합: ${num1 + num2} 칸 이동`;
        const doubleMsg = document.getElementById('dice-popup-double-msg');
        doubleMsg.style.display = isDouble ? 'block' : 'none';
        overlay.style.display = 'flex';
        
        // [사운드 비동기 락 마운트] 주사위 효과음(dice.mp3)이 재생 완료될 때까지 팝업을 유지하도록 동기화합니다.
        await this.triggerAudio('dice.mp3', true); 
        
        await this.checkPause();
        overlay.style.display = 'none';
    }

    askSpaceDestination() {
        return new Promise((resolve) => {
            document.getElementById('turn-info').innerText = `🚀 우주여행: 워프 목적지를 설정하세요`;
            const container = document.getElementById('action-controls');
            let optionsHTML = '';
            for(let i=0; i<this.TOTAL_TILES; i++) {
                if(i !== 27) optionsHTML += `<option value="${i}">${this.tiles[i].name}</option>`;
            }
            container.innerHTML = `
                <select id="space-select" style="padding:10px; border-radius:6px; font-size:1rem; border:2px solid #3498db; outline:none;">
                    ${optionsHTML}
                </select>
                <button id="btn-warp" class="btn btn-action" style="margin-left:10px;">순간 이동(Warp)</button>
            `;
            container.style.display = 'flex';
            document.getElementById('btn-warp').onclick = async () => {
                const selected = parseInt(document.getElementById('space-select').value);
                container.style.display = 'none';
                await this.checkPause();
                resolve(selected);
            };
        });
    }

    aiChooseSpaceDestination(player) {
        let bestTile = 35; 
        let maxVal = -1;
        for(let i=0; i<this.TOTAL_TILES; i++) {
            let t = this.tiles[i];
            if(t.type === 'land' && t.owner === null) {
                if(t.basePrice > maxVal && player.money >= t.basePrice) {
                    maxVal = t.basePrice;
                    bestTile = i;
                }
            }
        }
        if(maxVal === -1) {
             for(let i=0; i<this.TOTAL_TILES; i++) {
                 let t = this.tiles[i];
                 if(t.owner === player.id && t.buildings < 3 && t.group !== 'blue') {
                      if(t.buildingPrice > maxVal && player.money >= t.buildingPrice) {
                          maxVal = t.buildingPrice;
                          bestTile = i;
                      }
                 }
             }
        }
        return bestTile;
    }

    askBuildingChoice(tile) {
        return new Promise((resolve) => {
            document.getElementById('turn-info').innerText = `🏢 건물 시공 선택 (${tile.name})`;
            const container = document.getElementById('action-controls');
            const types = ['별장', '빌딩', '호텔'];
            const nextType = types[tile.buildings];
            const emoji = nextType === '별장' ? '🏡' : (nextType === '빌딩' ? '🏢' : '🏨');

            container.innerHTML = `
                <button id="btn-build-select" class="btn btn-action">${emoji} ${nextType} 건설 (${tile.buildingPrice.toLocaleString()}원)</button>
                <button id="btn-build-skip" class="btn btn-cancel">보류하기</button>
            `;
            container.style.display = 'flex';

            if (this.players[0].money < tile.buildingPrice) {
                document.getElementById('btn-build-select').disabled = true;
                document.getElementById('btn-build-select').innerText = '자산 부족';
            }

            document.getElementById('btn-build-select').onclick = async () => {
                container.style.display = 'none';
                await this.checkPause();
                resolve(nextType);
            };
            document.getElementById('btn-build-skip').onclick = async () => {
                container.style.display = 'none';
                await this.checkPause();
                resolve(null);
            };
        });
    }

    askUserChoice(title, yesText, noText) {
        return new Promise((resolve) => {
            document.getElementById('turn-info').innerText = `선택 대기: ${title}`;
            const container = document.getElementById('action-controls');
            container.innerHTML = `
                <button id="modal-yes" class="btn btn-action">${yesText}</button>
                <button id="modal-no" class="btn btn-cancel">${noText}</button>
            `;
            container.style.display = 'flex';

            document.getElementById('modal-yes').onclick = async () => { 
                container.style.display = 'none'; 
                await this.checkPause();
                resolve(true); 
            };
            document.getElementById('modal-no').onclick = async () => { 
                container.style.display = 'none'; 
                await this.checkPause();
                resolve(false); 
            };
        });
    }

    getGridCoords(index) {
        if (index >= 0 && index <= 9) return { r: 10, c: 10 - index };
        if (index >= 10 && index <= 18) return { r: 10 - (index - 9), c: 1 };
        if (index >= 19 && index <= 27) return { r: 1, c: index - 17 };
        if (index >= 28 && index <= 35) return { r: index - 26, c: 10 };
    }
    async checkPause() { while (this.isGamePaused) { await new Promise(r => setTimeout(r, 200)); } }
    getDiceEmoji(num) { const em = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']; return em[num - 1] || '🎲'; }

    pressGameStart() {
        document.getElementById('start-screen-box').style.display = 'none';
        document.getElementById('character-box').style.display = 'block';
    }

    selectCharacter(emoji) {
        this.selectedUserEmoji = emoji;
        document.getElementById('character-box').style.display = 'none';
        document.getElementById('color-box').style.display = 'block';
    }

    goBackToCharacter() {
        document.getElementById('color-box').style.display = 'none';
        document.getElementById('character-box').style.display = 'block';
    }

    selectColor(color) {
        this.selectedUserColor = color;
    }

    rollDiceClick() {
        document.getElementById('dice-btn').disabled = true;
        if (this.userDiceResolver) {
            let res = this.userDiceResolver;
            this.userDiceResolver = null;
            res();
        }
    }

    togglePause() {
        this.isGamePaused = !this.isGamePaused;
        const pBtn = document.getElementById('pause-btn');
        const dBtn = document.getElementById('dice-btn');
        
        if (this.isGamePaused) {
            pBtn.innerText = "▶ 게임 재개 (Resume)"; 
            pBtn.style.backgroundColor = "#e67e22";
            clearInterval(this.gameTimer);
            this.systemAnnounce("시스템 일시정지: 내부 연산이 중단되었습니다.", "#f39c12");
            if (!dBtn.disabled && this.players[this.currentTurn].id === 0) { 
                dBtn.dataset.wasEnabled = "true"; 
                dBtn.disabled = true; 
            }
        } else {
            pBtn.innerText = "⏸ 게임 일시정지 (Pause)"; 
            pBtn.style.backgroundColor = "#2c3e50";
            this.startCountdownTimer();
            this.systemAnnounce("시스템 재가동: 메인 비즈니스 루프가 재개됩니다.", "#2ecc71");
            if (dBtn.dataset.wasEnabled === "true") { 
                dBtn.disabled = false; 
                dBtn.dataset.wasEnabled = "false"; 
            }
        }
    }

    initTimer(minutes) {
        this.remainingSeconds = minutes * 60;
        const mins = Math.floor(this.remainingSeconds / 60);
        const secs = this.remainingSeconds % 60;
        document.getElementById('timer-display').innerText = `남은 시간: ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
}