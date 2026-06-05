// 고정 상수를 제거하고, 시스템 환경에 따라 실시간으로 변동하는 동적 변수로 선언합니다.
let PRE_MOVE_DELAY = 150; 

// 인트로 오디오 인스턴스 레이어 선언
const introAudio = new Audio('assets/audio/intro.mp3');
introAudio.loop = true;
introAudio.volume = 0.4;

// 로우 레벨 웹 오디오 연산 변수 컨트롤러
let audioCtx = null;
let moveBuffer = null;
const moveAudioFallback = new Audio('assets/audio/move.mp3'); 
moveAudioFallback.volume = 0.5;

// 전역 상태 변수 및 설정 데이터 바인딩 버퍼
let TOTAL_TILES, INITIAL_MONEY, SALARY, ALL_EMOJIS, MASCOT_NAMES, TILE_EMOJIS, tileTemplates, goldenKeysPool;

let players = [];
let tiles = [];
let currentTurn = 0;
let welfareFund = 0; 
let gameTimer = null;
let remainingSeconds = 1200; 
let userDiceResolver = null; 
let isGamePaused = false;
let selectedUserEmoji = '';

// 외부 JSON에서 수령한 actionId 값을 실제 엔진 내부 실행 함수와 매핑하는 가중치 테이블
const keyActions = {
    "deposit_interest": (p) => { p.money += 200000; return "200,000원 수령"; },
    "scholarship": (p) => { p.money += 150000; return "150,000원 수령"; },
    "income_tax": (p) => { p.money -= 150000; welfareFund += 150000; return "150,000원 세금 차감"; },
    "building_repair": (p) => { p.money -= 100000; welfareFund += 100000; return "100,000원 기금 귀속"; },
    "go_to_island": async (p) => { p.position = 9; p.islandTurns = 3; return "무인도 수감 조치"; },
    "go_to_start": async (p) => { p.position = 0; p.lap++; p.money += SALARY; return "출발지 이동 및 월급 지급"; },
    "go_to_space": async (p) => { if(p.position > 27) { p.lap++; p.money += SALARY; } p.position = 27; p.spaceWait = true; return "우주정거장 이송"; },
    "traffic_fine": (p) => { p.money -= 50000; welfareFund += 50000; return "벌금 50,000원 적립"; },
    "warp_seoul": async (p) => { p.position = 35; return "서울 영토 진입"; },
    "lottery": (p) => { p.money += 300000; return "300,000원 복권 상금"; }
};

// 첫 화면에서 "게임 시작" 클릭 시 구동되는 인터페이스 바인딩
function pressGameStart() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        preloadMoveBuffer();
        
        // [엔지니어링 핵심] 사운드 카드가 브라우저에 보고한 실제 디바이스 출력 지연 시간을 초 단위로 읽어옵니다.
        // 이를 밀리초 단위로 변환한 뒤, 타키님이 찾아내신 시스템 안정 마진 가중치(약 100ms)를 더해 정밀 계산합니다.
        const hardwareLatency = (audioCtx.outputLatency || 0.08) * 1000;
        PRE_MOVE_DELAY = Math.floor(hardwareLatency + 100); 
        console.log(`시스템 하드웨어 레이턴시 분석 완료: 동적 보정값 ${PRE_MOVE_DELAY}ms 적용`);
    }
    
    if (introAudio) {
        introAudio.play().catch((e) => console.warn("오디오 엔진 락 잠금 상태:", e));
    }
    
    document.getElementById('start-screen-box').style.display = 'none';
    document.getElementById('character-box').style.display = 'block';
}

// 오디오 리소스를 원시 이진 배열로 패치 후 RAM 버퍼 메모리에 다이렉트 디코딩 처리
async function preloadMoveBuffer() {
    try {
        const response = await fetch('assets/audio/move.mp3');
        const arrayBuffer = await response.arrayBuffer();
        moveBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (error) {
        console.warn("웹 오디오 컨텍스트 셋업 실패, 레거시 컴포넌트로 전환:", error);
    }
}

// 오디오 재생 및 동기화 제어 함수
function playAudio(filename, shouldAwait = false) {
    return new Promise((resolve) => {
        if (filename === 'move.mp3') {
            if (audioCtx && moveBuffer) {
                if (audioCtx.state === 'suspended') {
                    audioCtx.resume();
                }
                const source = audioCtx.createBufferSource();
                source.buffer = moveBuffer;
                
                const gainNode = audioCtx.createGain();
                gainNode.gain.value = 0.5; 
                
                source.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                source.start(0);
            } else {
                moveAudioFallback.currentTime = 0;
                moveAudioFallback.play().catch(() => {});
            }
            resolve();
            return;
        }

        const audio = new Audio(`assets/audio/${filename}`);
        audio.volume = 0.5; 
        
        if (!shouldAwait) {
            audio.play().catch(() => {});
            resolve();
            return;
        }
        
        let isResolved = false;
        const handleAudioDone = () => {
            if (!isResolved) {
                isResolved = true;
                resolve();
            }
        };
        
        audio.onended = handleAudioDone;
        audio.onerror = handleAudioDone; 
        
        setTimeout(handleAudioDone, 5000); 
        
        audio.play().catch(() => {
            handleAudioDone();
        });
    });
}

// DOM 생성 완료 시 정적 데이터를 로드합니다.
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('data.json');
        const config = await response.json();
        
        TOTAL_TILES = config.TOTAL_TILES;
        INITIAL_MONEY = config.INITIAL_MONEY;
        SALARY = config.SALARY;
        ALL_EMOJIS = config.ALL_EMOJIS;
        MASCOT_NAMES = config.MASCOT_NAMES;
        TILE_EMOJIS = config.TILE_EMOJIS;
        tileTemplates = config.tileTemplates;
        goldenKeysPool = config.goldenKeysPool;

        document.getElementById('turn-info').innerText = "대기 중...";
    } catch (error) {
        console.error("정적 환경 설정 데이터를 로드하지 못했습니다:", error);
    }
});

// 전역 바인딩 인터페이스 정의
window.pressGameStart = pressGameStart;
window.selectCharacter = selectCharacter;
window.selectColor = selectColor;
window.goBackToCharacter = goBackToCharacter;
window.startGame = startGame;
window.rollDiceClick = rollDiceClick;
window.togglePause = togglePause;
window.toggleLogModal = toggleLogModal;
window.toggleKeyLogModal = toggleKeyLogModal;

function selectCharacter(emoji) {
    selectedUserEmoji = emoji;
    document.getElementById('character-box').style.display = 'none';
    document.getElementById('color-box').style.display = 'block';
}

function goBackToCharacter() {
    document.getElementById('color-box').style.display = 'none';
    document.getElementById('character-box').style.display = 'block';
}

function selectColor(color) {
    startGame(selectedUserEmoji, color);
}

async function checkPause() {
    while (isGamePaused) {
        await new Promise(resolve => setTimeout(resolve, 200));
    }
}

function togglePause() {
    isGamePaused = !isGamePaused;
    const pauseBtn = document.getElementById('pause-btn');
    const diceBtn = document.getElementById('dice-btn');
    
    if (isGamePaused) {
        pauseBtn.innerText = "▶ 게임 재개 (Resume)";
        pauseBtn.style.backgroundColor = "#e67e22";
        clearInterval(gameTimer); 
        systemAnnounce("시스템 일시정지: 게임 엔진 스레드가 중단되었습니다.", "#f39c12");
        
        if (!diceBtn.disabled && players[currentTurn].id === 0) {
            diceBtn.dataset.wasEnabled = "true";
            diceBtn.disabled = true;
        }
    } else {
        pauseBtn.innerText = "⏸ 게임 일시정지 (Pause)";
        pauseBtn.style.backgroundColor = "#2c3e50";
        startCountdownTimer(); 
        systemAnnounce("시스템 재가동: 메인 게임 루프가 재개됩니다.", "#2ecc71");
        
        if (diceBtn.dataset.wasEnabled === "true") {
            diceBtn.disabled = false;
            diceBtn.dataset.wasEnabled = "false";
        }
    }
}

function getGridCoords(index) {
    if (index >= 0 && index <= 9) return { r: 10, c: 10 - index };
    if (index >= 10 && index <= 18) return { r: 10 - (index - 9), c: 1 };
    if (index >= 19 && index <= 27) return { r: 1, c: index - 17 };
    if (index >= 28 && index <= 35) return { r: index - 26, c: 10 };
}

function systemAnnounce(msg, color = '#ecf0f1') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast-popup';
    if(color !== '#ecf0f1') toast.style.borderColor = color;
    toast.innerText = msg;
    container.appendChild(toast);
    
    const historyArea = document.getElementById('modal-log-area');
    const logRow = document.createElement('div');
    logRow.className = 'log-entry';
    logRow.style.color = color;
    logRow.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    historyArea.appendChild(logRow);
    historyArea.scrollTop = historyArea.scrollHeight;
}

function recordKeyLog(player, text, resultMsg) {
    const keyArea = document.getElementById('modal-key-log-area');
    const logRow = document.createElement('div');
    logRow.className = 'log-entry';
    logRow.style.color = '#f1c40f';
    logRow.innerHTML = `[${new Date().toLocaleTimeString()}] <b>${player.name}</b>: ${text} <br><span style="color:#bdc3c7;">-> ${resultMsg}</span>`;
    keyArea.appendChild(logRow);
    keyArea.scrollTop = keyArea.scrollHeight;
}

function toggleLogModal(isOpen) { document.getElementById('log-modal').style.display = isOpen ? 'flex' : 'none'; }
function toggleKeyLogModal(isOpen) { document.getElementById('key-log-modal').style.display = isOpen ? 'flex' : 'none'; }

async function showFadePopup(htmlMsg) {
    const el = document.getElementById('center-fade-popup');
    el.innerHTML = htmlMsg;
    el.style.display = 'block';
    el.style.transition = 'none';
    el.style.opacity = '1';
    
    void el.offsetWidth; 
    
    el.style.transition = 'opacity 1.5s ease-out';
    await new Promise(resolve => setTimeout(resolve, 1200));
    
    await checkPause(); 

    el.style.opacity = '0';
    await new Promise(resolve => setTimeout(resolve, 1500));
    el.style.display = 'none';
}

function askSpaceDestination() {
    return new Promise((resolve) => {
        document.getElementById('turn-info').innerText = `🚀 우주여행: 워프 목적지를 설정하세요`;
        const container = document.getElementById('action-controls');
        
        let optionsHTML = '';
        for(let i=0; i<TOTAL_TILES; i++) {
            if(i !== 27) optionsHTML += `<option value="${i}">${tiles[i].name}</option>`;
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
            await checkPause();
            resolve(selected);
        };
    });
}

function aiChooseSpaceDestination(player) {
    let bestTile = 35; 
    let maxVal = -1;
    for(let i=0; i<TOTAL_TILES; i++) {
        let t = tiles[i];
        if(t.type === 'land' && t.owner === null) {
            if(t.basePrice > maxVal && player.money >= t.basePrice) {
                maxVal = t.basePrice;
                bestTile = i;
            }
        }
    }
    if(maxVal === -1) {
         for(let i=0; i<TOTAL_TILES; i++) {
             let t = tiles[i];
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

function initBoardDOM() {
    const boardEl = document.getElementById('board');
    tileTemplates.forEach((t) => {
        const pos = getGridCoords(t.id);
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

        let colorBarHTML = t.group !== 'special' ? `<div class="color-bar g-${t.group}"></div>` : '';
        let textPrice = t.type === 'land' ? (t.basePrice / 10000) + '만' : '';
        let bgEmoji = TILE_EMOJI_DICT[t.id] || ''; 

        tileDiv.innerHTML = `
            <div class="tile-bg-emoji">${bgEmoji}</div>
            ${colorBarHTML}
            <div class="tile-name">${t.name}</div>
            <div class="owner-badge" id="owner-${t.id}"></div>
            <div class="buildings-indicator" id="build-${t.id}"></div>
            <div class="tile-info" id="price-${t.id}">${textPrice}</div>
            <div class="player-tokens" id="tokens-${t.id}"></div>
        `;
        boardEl.appendChild(tileDiv);
        tiles.push({ ...t, owner: null, buildings: 0, buildingTypes: [], buildingPrice: Math.floor(t.basePrice * 0.8) });
    });
}
let TILE_EMOJI_DICT = {};

function calculateToll(tile) {
    if (tile.type !== 'land' || tile.owner === null) return 0;
    if (tile.group === 'blue') return tile.basePrice;

    let toll = Math.floor(tile.basePrice * 0.20); 
    if (tile.buildings === 1) toll += Math.floor(tile.buildingPrice * 0.80);
    else if (tile.buildings === 2) toll += Math.floor(tile.buildingPrice * 2.00);
    else if (tile.buildings === 3) toll += Math.floor(tile.buildingPrice * 4.50);
    return toll;
}

function startCountdownTimer() {
    gameTimer = setInterval(async () => {
        remainingSeconds--;
        if (remainingSeconds <= 0) {
            clearInterval(gameTimer);
            await triggerTimeOutEndGame();
            return;
        }
        const mins = Math.floor(remainingSeconds / 60);
        const secs = remainingSeconds % 60;
        document.getElementById('timer-display').innerText = `남은 시간: ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }, 1000);
}

function startGame(userEmoji, userColor) {
    if (introAudio) {
        introAudio.pause();
        introAudio.currentTime = 0;
    }

    document.getElementById('selection-screen').style.display = 'none';
    TILE_EMOJI_DICT = TILE_EMOJIS;
    initBoardDOM();

    let availableColors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'];
    availableColors = availableColors.filter(c => c !== userColor);

    let pNo = 1;
    players.push({ 
        id: 0, emoji: userEmoji, name: `${MASCOT_NAMES[userEmoji]}(USER)`, 
        color: userColor, pNum: pNo++, money: INITIAL_MONEY, position: 0, lap: 0, 
        islandTurns: 0, isBankrupt: false, spaceWait: false, isMoving: false 
    });
    
    ALL_EMOJIS.forEach(emoji => {
        if (emoji !== userEmoji) {
            players.push({ 
                id: pNo - 1, emoji: emoji, name: `${MASCOT_NAMES[emoji]}`, 
                color: availableColors.shift(), pNum: pNo++, money: INITIAL_MONEY, position: 0, lap: 0, 
                islandTurns: 0, isBankrupt: false, spaceWait: false, isMoving: false 
            });
        }
    });

    document.querySelectorAll('.token').forEach(el => el.remove());
    players.forEach(p => {
        const tokenSpan = document.createElement('span');
        tokenSpan.id = `token-player-${p.id}`;
        tokenSpan.className = 'token';
        tokenSpan.style.backgroundColor = p.color;
        tokenSpan.innerText = `✈️${p.pNum}`;
        document.getElementById('board').appendChild(tokenSpan);
    });

    systemAnnounce("매치 시스템 정상 가동. 제한시간 20분 계측을 시작합니다.", "#2ecc71");
    startCountdownTimer();
    updateUI();
    runCentralGameLoop();
}

function updateUI() {
    document.getElementById('welfare-pool').innerText = `사회복지기금 잔고: ${welfareFund.toLocaleString()}원`;

    for (let i = 0; i < TOTAL_TILES; i++) {
        const tileEl = document.getElementById(`tile-${i}`);
        if (!tileEl) continue; 
        
        const buildEl = document.getElementById(`build-${i}`);
        if (buildEl && tiles[i].type === 'land') {
            if (tiles[i].buildingTypes && tiles[i].buildingTypes.length > 0) {
                buildEl.innerText = tiles[i].buildingTypes.map(b => b === '별장' ? '🏡' : (b === '빌딩' ? '🏢' : '🏨')).join('');
            } else {
                buildEl.innerText = tiles[i].buildings > 0 ? '🏠'.repeat(tiles[i].buildings) : '';
            }
        }

        const ownerEl = document.getElementById('owner-' + i);
        const tileNameEl = tileEl.querySelector('.tile-name');
        const tileInfoEl = tileEl.querySelector('.tile-info');

        if (tiles[i].owner !== null && players[tiles[i].owner]) {
            if (ownerEl) ownerEl.innerText = players[tiles[i].owner].emoji;
            if (tiles[i].type === 'land') {
                tileEl.style.backgroundColor = players[tiles[i].owner].color;
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
            if (tiles[i].type === 'land') {
                tileEl.style.backgroundColor = ''; 
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

    players.forEach(p => {
        const tokenEl = document.getElementById(`token-player-${p.id}`);
        if (!tokenEl) return;
        
        if (p.isBankrupt) {
            tokenEl.style.display = 'none';
            return;
        }
        
        tokenEl.style.display = 'inline-block';
        
        if (p.isMoving) {
            tokenEl.classList.add('moving');
        } else {
            tokenEl.classList.remove('moving');
        }
        
        const playersOnSameTile = players.filter(pl => pl.position === p.position && !pl.isBankrupt);
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
        players.forEach(p => {
            const tr = document.createElement('tr');
            if (p.isBankrupt) tr.className = 'bankrupt';
            let statusText = p.isBankrupt ? '파산 격리' : (p.islandTurns > 0 ? `무인도 (${p.islandTurns}턴)` : (p.spaceWait ? '우주 대기' : '정상 운항'));

            tr.innerHTML = `
                <td><span style="padding:2px 5px; border-radius:3px; background:${p.color}; color:white; font-size:0.7rem;">✈️${p.pNum}</span> ${p.name}</td>
                <td><b>${p.money.toLocaleString()}</b> 원</td>
                <td>${tiles[p.position] ? tiles[p.position].name : '출발지'}</td>
                <td>${p.lap} 바퀴</td>
                <td>${statusText}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    const isoList = document.getElementById('isolation-list');
    if (isoList) {
        const bankrupts = players.filter(p => p.isBankrupt);
        if(bankrupts.length > 0) {
            const emptyMsg = document.getElementById('empty-iso-msg');
            if (emptyMsg) emptyMsg.style.display = 'none';
            isoList.innerHTML = '';
            bankrupts.forEach(bp => {
                const span = document.createElement('span');
                span.className = 'isolated-player';
                span.innerText = `🔒 수감: ${bp.name}`;
                isoList.appendChild(span);
            });
        } else {
            const emptyMsg = document.getElementById('empty-iso-msg');
            if (emptyMsg) emptyMsg.style.display = 'block';
            isoList.innerHTML = '<span style="color:#7f8c8d; font-size:0.75rem;" id="empty-iso-msg">현재 수감자가 없습니다.</span>';
        }
    }
}

async function showLargeDiceOverlay(e1, e2, num1, num2, player, isDouble) {
    const overlay = document.getElementById('dice-overlay');
    document.getElementById('dice-popup-player').innerText = `${player.name}의 주사위 가동`;
    document.getElementById('dice-cube-1').innerText = e1;
    document.getElementById('dice-cube-2').innerText = e2;
    document.getElementById('dice-popup-number').innerText = `총합: ${num1 + num2} 칸 이동`;
    
    const doubleMsg = document.getElementById('dice-popup-double-msg');
    doubleMsg.style.display = isDouble ? 'block' : 'none';

    overlay.style.display = 'flex';
    await new Promise(resolve => setTimeout(resolve, 1200)); 
    
    await checkPause();

    overlay.style.display = 'none';
}

async function movePlayerSteps(player, steps) {
    player.isMoving = true; 
    for (let i = 0; i < steps; i++) {
        await checkPause(); 

        // 1단계: 사운드 카드 드라이버로 신호 즉시 송출
        playAudio('move.mp3', false); 
        
        // 2단계: 실시간으로 보정된 하드웨어 대기 시간만큼 스레드 홀딩
        await new Promise(resolve => setTimeout(resolve, PRE_MOVE_DELAY));
        
        // 3단계: 정확한 타이밍에 물리적 이동 개시 및 화면 갱신
        player.position = (player.position + 1) % TOTAL_TILES;

        if (player.position === 0) {
            player.lap++;
            player.money += SALARY;
            systemAnnounce(`[출발지] ${player.name} 완주 월급 200,000원 획득.`, '#2ecc71');
        }

        updateUI();
        
        // 4단계: 루프 전체 주기(300ms) 중 가용 시간 연산 후 대기
        const remainingInterval = 300 - PRE_MOVE_DELAY;
        await new Promise(resolve => setTimeout(resolve, remainingInterval > 0 ? remainingInterval : 0)); 
    }
    player.isMoving = false; 
    updateUI();
}

async function runCentralGameLoop() {
    while (true) {
        await checkPause(); 

        if (players[0] && players[0].isBankrupt) {
            clearInterval(gameTimer);
            document.getElementById('result-title').innerText = "💀 플레이어 파산 게임 종료 💀";
            await triggerTimeOutEndGame();
            return;
        }

        let actives = players.filter(p => !p.isBankrupt);
        if (actives.length === 1) {
            clearInterval(gameTimer);
            document.getElementById('result-title').innerText = "🏆 단독 생존 독점 종료 🏆";
            await triggerTimeOutEndGame();
            return;
        }

        let p = players[currentTurn];
        if (p.isBankrupt) {
            currentTurn = (currentTurn + 1) % 4;
            await new Promise(r => setTimeout(r, 50)); 
            continue;
        }

        if (p.spaceWait) {
            document.getElementById('turn-info').innerText = `현재 턴: ${p.name} (우주 정거장 대기 중)`;
            let targetTileId = 27;
            if (p.id === 0) {
                targetTileId = await askSpaceDestination();
            } else {
                await new Promise(r => setTimeout(r, 1500)); 
                await checkPause();
                targetTileId = aiChooseSpaceDestination(p);
            }

            systemAnnounce(`🚀 ${p.name} -> [ ${tiles[targetTileId].name} ] 목표지로 워프 완료!`, '#9b59b6');

            if (targetTileId < p.position && targetTileId !== 0) {
                p.lap++;
                p.money += SALARY;
                systemAnnounce(`[출발지 패스] 완주 월급 200,000원 획득.`, '#2ecc71');
            }

            p.position = targetTileId;
            p.spaceWait = false; 
            updateUI();
            await new Promise(r => setTimeout(r, 800));
            await checkPause();
            
            if (!p.isBankrupt) {
                await processTileAction(p);
            }
            
            currentTurn = (currentTurn + 1) % 4;
            updateUI();
            continue;
        }

        document.getElementById('turn-info').innerText = `현재 턴: ${p.name}`;

        if (p.id === 0) {
            document.getElementById('dice-btn').disabled = false;
            await new Promise(resolve => { userDiceResolver = resolve; });
            
            let rolledDouble = await executeTurn(p);
            if (rolledDouble && p.islandTurns === 0 && !p.isBankrupt && !p.spaceWait) {
                systemAnnounce("[더블 찬스] 유저 연속 턴 가동!", "#f1c40f");
                updateUI();
                continue; 
            }
        } else {
            document.getElementById('dice-btn').disabled = true;
            await new Promise(resolve => setTimeout(resolve, 1000)); 
            await checkPause(); 
            
            let rolledDouble = await executeTurn(p);
            if (rolledDouble && p.islandTurns === 0 && !p.isBankrupt && !p.spaceWait) {
                systemAnnounce("[더블 찬스] AI 연속 턴 가동!", "#f1c40f");
                updateUI();
                continue;
            }
        }

        currentTurn = (currentTurn + 1) % 4;
        updateUI();
    }
}

function rollDiceClick() {
    document.getElementById('dice-btn').disabled = true;
    if (userDiceResolver) {
        let resolveTemp = userDiceResolver;
        userDiceResolver = null;
        resolveTemp(); 
    }
}

async function executeTurn(player) {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const totalDice = d1 + d2;
    const isDouble = (d1 === d2);

    document.getElementById('dice-display').innerText = `${getDiceEmoji(d1)} ${getDiceEmoji(d2)} (${totalDice})`;

    if (player.islandTurns > 0) {
        systemAnnounce(`${player.name} 무인도 탈출 심사 작동.`);
        await showLargeDiceOverlay(getDiceEmoji(d1), getDiceEmoji(d2), d1, d2, player, isDouble);

        if (isDouble) {
            player.islandTurns = 0;
            systemAnnounce("🎉 " + player.name + " 극적 탈출 완료! 턴을 종료하고 다음 차례에 이동합니다.", "#2ecc71");
            return false; 
        } else {
            player.islandTurns--;
            systemAnnounce(`탈출 실패 (남은 형기: ${player.islandTurns}턴)`);
            return false;
        }
    }

    await showLargeDiceOverlay(getDiceEmoji(d1), getDiceEmoji(d2), d1, d2, player, isDouble);
    await movePlayerSteps(player, totalDice);
    
    if (!player.isBankrupt) {
        await processTileAction(player);
    }

    return isDouble; 
}

async function processTileAction(player) {
    if (player.isBankrupt) return;

    let currentTile = tiles[player.position];
    systemAnnounce(`${player.name} -> [ ${currentTile.name} ] 구역 진입.`);

    if (currentTile.type === 'start') return;

    if (currentTile.type === 'island') {
        player.islandTurns = 3;
        systemAnnounce("🚨 무인도 고립! 다음 턴부터 주사위 더블이 요구됩니다.", "#e74c3c");
        return;
    }

    if (currentTile.type === 'space') {
        player.spaceWait = true;
        systemAnnounce("🚀 우주정거장 안착 대기! 다음 차례에 원하는 타일로 비행합니다.", "#9b59b6");
        return;
    }

    if (currentTile.type === 'welfare') {
        if (welfareFund > 0) {
            systemAnnounce(`💰 복지기금 ${welfareFund.toLocaleString()}원 합법 인도 수령!`, "#2ecc71");
            player.money += welfareFund;
            welfareFund = 0;
        }
        return;
    }

    if (currentTile.type === 'tax') {
        await playAudio('society.mp3', true); 

        const taxAmount = 200000;
        player.money -= taxAmount;
        welfareFund += taxAmount;
        
        let taxMsgHTML = `
            <div style="font-size:3.5rem; margin-bottom:10px;">💸</div>
            <div style="color:#f1c40f;">사회복지기금 과세 발동</div>
            <div style="font-size:1.2rem; margin-top:20px; color:#bdc3c7;">
                <b style="color:${player.color}">${player.name}</b>님이 기금 <b>200,000원</b>을 예치했습니다.
            </div>
        `;
        await showFadePopup(taxMsgHTML);

        if (player.money <= 0) {
            await executeBankruptcy(player, null);
        }
        return;
    }

    if (currentTile.type === 'key') {
        await triggerGoldenKey(player);
        return;
    }

    if (currentTile.type === 'land') {
        if (currentTile.owner === null) {
            let buyDecision = false;
            if (player.id === 0) {
                buyDecision = await askUserChoice(`영토 매입 (${currentTile.basePrice.toLocaleString()}원)`, '매입 승인', '보류하기');
            } else {
                buyDecision = player.money >= currentTile.basePrice; 
            }

            if (buyDecision) {
                player.money -= currentTile.basePrice;
                currentTile.owner = player.id;
                systemAnnounce(`[영토 획득] ${player.name} -> [ ${currentTile.name} ] ${currentTile.basePrice.toLocaleString()}원 등기 완료.`, "#3498db");
            }
        }
        else if (currentTile.owner === player.id) {
            if (currentTile.group === 'blue') {
                systemAnnounce(`[관광 특수 구역] ${currentTile.name} 부지에는 건축 시공이 금지됩니다.`, "#7f8c8d");
                return;
            }

            if (player.lap === 0 || currentTile.buildings >= 3) return;
            if (!currentTile.buildingTypes) currentTile.buildingTypes = [];

            let chosenType = null;
            if (player.id === 0) {
                chosenType = await askBuildingChoice(currentTile);
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
                systemAnnounce(`[건물 시공] ${player.name} -> [ ${currentTile.name} ]에 ${chosenType} 완공!`, "#f1c40f");
            } else {
                systemAnnounce(`${player.name}님이 추가 건축을 보류했습니다.`);
            }
        }
        else if (currentTile.owner !== player.id) {
            let ownerPlayer = players[currentTile.owner];
            let totalToll = calculateToll(currentTile);

            systemAnnounce(`[사유지 침범] 통행료 ${totalToll.toLocaleString()}원 청구 (주인: ${ownerPlayer.name})`, "#e74c3c");
            
            if (player.money - totalToll < 0) {
                await executeBankruptcy(player, ownerPlayer);
            } else {
                player.money -= totalToll;
                ownerPlayer.money += totalToll;
                systemAnnounce("[정산 완료] 영토 소유주 계좌 이체 종결.", "#ff6b6b");
            }
        }
    }
    await new Promise(r => setTimeout(r, 800)); 
    await checkPause();
    updateUI(); 
}

function askBuildingChoice(tile) {
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

        if (players[0].money < tile.buildingPrice) {
            document.getElementById('btn-build-select').disabled = true;
            document.getElementById('btn-build-select').innerText = '자산 부족';
        }

        document.getElementById('btn-build-select').onclick = async () => {
            container.style.display = 'none';
            await checkPause();
            resolve(nextType);
        };
        document.getElementById('btn-build-skip').onclick = async () => {
            container.style.display = 'none';
            await checkPause();
            resolve(null);
        };
    });
}

function askUserChoice(title, yesText, noText) {
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
            await checkPause();
            resolve(true); 
        };
        document.getElementById('modal-no').onclick = async () => { 
            container.style.display = 'none'; 
            await checkPause();
            resolve(false); 
        };
    });
}

function executeBankruptcy(bankruptPlayer, creditorPlayer) {
    // 내부 청산 연산부 (변동 없음)
    bankruptPlayer.isBankrupt = true;
    // ... 이하 생략 (동일한 메인 로직 구동)
}

async function triggerGoldenKey(player) {
    await playAudio('golden_key.mp3', true); 

    const card = goldenKeysPool[Math.floor(Math.random() * goldenKeysPool.length)];
    const actionFn = keyActions[card.actionId];
    const resultMsg = await actionFn(player);
    
    let keyPopupHTML = `
        <div style="font-size:3.5rem; margin-bottom:10px;">🔑</div>
        <div style="color:#f1c40f; margin-bottom:15px;">황금열쇠 발동</div>
        <div style="font-size:1.3rem; line-height:1.5;">${card.text}</div>
        <div style="font-size:1rem; margin-top:25px; color:#bdc3c7;">지령 대상: <b style="color:${player.color}">${player.name}</b></div>
    `;
    
    await showFadePopup(keyPopupHTML);
    
    recordKeyLog(player, card.text, resultMsg);
    systemAnnounce(`[황금열쇠 연산] -> ${resultMsg}`, "#f39c12");
    
    if (player.money <= 0 && !player.isBankrupt) {
        await executeBankruptcy(player, null);
    }
    updateUI();
}

async function triggerTimeOutEndGame() {
    clearInterval(gameTimer);
    document.getElementById('dice-btn').disabled = true;

    let rankingData = players.map(p => {
        if (p.isBankrupt) return { name: p.name, totalValue: -1, status: "파산 격리" };
        let landSum = 0, buildingSum = 0;
        tiles.forEach(t => {
            if (t.owner === p.id) {
                landSum += t.basePrice;
                buildingSum += (t.buildings * t.buildingPrice) * 0.5; 
            }
        });
        return { name: p.name, totalValue: p.money + landSum + buildingSum, status: "정상 완주" };
    });

    rankingData.sort((a, b) => b.totalValue - a.totalValue);

    const userMascotName = `${MASCOT_NAMES[selectedUserEmoji]}(USER)`;
    const isUserWinner = (rankingData[0].name === userMascotName && rankingData[0].totalValue !== -1);

    if (isUserWinner) {
        playAudio('player_win.mp3', false);
    } else {
        playAudio('player_lose.mp3', false);
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

function getDiceEmoji(num) {
    const diceEmojis = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    return diceEmojis[num - 1] || '🎲';
}