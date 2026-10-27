// ===== Supabase 연결 정보 (공개 키만 넣는다) =====
const SUPABASE_URL = "https://yqozyohpkshffspwjupi.supabase.co";
const SUPABASE_KEY = "sb_publishable_jvU2x-aKL4WIXfSLQhtRgQ_gddA-VPF";

// Supabase에 보낼 기본 머리말
const HEADERS = {
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json",
};

// 표에서 읽어 오기 (예: get("projects?select=*"))
async function get(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// 표에 한 줄 넣기. 넣은 줄을 돌려받는다.
async function post(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  return res;
}

// ===== 이 브라우저의 번호 (좋아요를 카드마다 한 번만 누르게) =====
function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // 저장이 막힌 브라우저에서는 이번 방문 동안만 기억한다
  }
}

function getClientId() {
  let id = readStorage("resume_client_id");
  if (!id) {
    id = window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    writeStorage("resume_client_id", id);
  }
  return id;
}

const clientId = getClientId();

function getLikedIds() {
  try {
    return JSON.parse(readStorage("resume_liked") || "[]");
  } catch (e) {
    return [];
  }
}

let likedIds = getLikedIds();

function rememberLiked(projectId) {
  if (!likedIds.includes(projectId)) likedIds.push(projectId);
  writeStorage("resume_liked", JSON.stringify(likedIds));
}

// ===== 작은 도우미 =====
function $(id) {
  return document.getElementById(id);
}

// 태그와 글자를 넣어 새 요소 만들기 (글자는 항상 textContent로 넣어 안전하게)
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// ===== 프로필 =====
async function loadProfile() {
  try {
    const rows = await get("profile?select=*&id=eq.1");
    const p = rows[0];
    if (!p) return;

    $("name").textContent = p.name;
    $("title").textContent = p.title;
    $("career-badge").textContent = p.career_badge;
    $("contact-name").textContent = p.name;
    $("contact-email").textContent = p.email;
    $("contact-phone").textContent = p.phone;
    $("contact-location").textContent = p.location;
    $("intro").textContent = p.intro;
    $("education").textContent = p.education;
    $("skills").textContent = p.skills;
    $("experience").textContent = p.experience;
    $("quote").textContent = p.quote;
    showHeadline(p.headline, p.name);

    if (p.photo_url) {
      const img = el("img");
      img.src = p.photo_url;
      img.alt = p.name;
      $("photo").replaceChildren(img);
    }

    if (p.name) document.title = `${p.name} | Portfolio`;
  } catch (e) {
    console.error("프로필을 불러오지 못했습니다:", e);
    $("headline").textContent = "프로필을 불러오지 못했습니다.";
  }
}

// 한 줄 소개에서 이름 부분에만 파란 밑줄을 긋는다
function showHeadline(headline, name) {
  const box = $("headline");
  box.replaceChildren();
  if (!name || !headline.includes(name)) {
    box.textContent = headline;
    return;
  }
  headline.split(name).forEach((part, i) => {
    if (i > 0) box.append(el("span", "hl-name", name));
    box.append(part);
  });
}

// ===== 포트폴리오 카드 =====
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.3 4 6.3 4c2.3 0 3.9 1.4 5.7 3.6C13.8 5.4 15.4 4 17.7 4c4 0 5.9 4.4 4.3 7.7C19.5 16.4 12 21 12 21z"/></svg>';

async function loadProjects() {
  const box = $("cards");
  try {
    const [projects, likes] = await Promise.all([
      get("projects?select=*&order=sort_order.asc,id.asc"),
      get("likes?select=project_id&limit=100000"),
    ]);

    // 카드별 좋아요 수 세기
    const counts = {};
    likes.forEach((row) => {
      counts[row.project_id] = (counts[row.project_id] || 0) + 1;
    });

    box.replaceChildren();
    if (projects.length === 0) {
      box.append(el("p", "empty", "아직 등록된 프로젝트가 없습니다."));
      return;
    }
    projects.forEach((p) => box.append(makeCard(p, counts[p.id] || 0)));
  } catch (e) {
    console.error("프로젝트를 불러오지 못했습니다:", e);
    box.replaceChildren(el("p", "empty", "프로젝트를 불러오지 못했습니다."));
  }
}

function makeCard(p, likeCount) {
  const card = el("article", "card");

  // 카드 위쪽(썸네일·글)은 누르면 파일이나 이미지를 새 탭으로 연다
  const open = el("button", "card-open");
  open.type = "button";
  const link = p.file_url || p.thumbnail_url;
  if (link) {
    open.addEventListener("click", () => window.open(link, "_blank", "noopener"));
  } else {
    open.disabled = true;
  }

  // 브라우저 창 모양 썸네일
  const browser = el("span", "browser");
  const bar = el("span", "browser-bar");
  bar.append(el("span"), el("span"), el("span"));
  const view = el("span", "browser-view");
  if (p.thumbnail_url) {
    const img = el("img");
    img.src = p.thumbnail_url;
    img.alt = p.title;
    img.loading = "lazy";
    view.append(img);
  }
  browser.append(bar, view);

  // 번호·분류, 제목, 설명
  const body = el("span", "card-body");
  const meta = [p.number, p.category].filter(Boolean).join(" · ");
  body.append(
    el("span", "card-meta", meta),
    el("span", "card-title", p.title),
    el("span", "card-desc", p.description)
  );

  open.append(browser, body);

  // 아래쪽: 태그와 좋아요
  const foot = el("div", "card-foot");
  const tags = el("div", "tags");
  (p.tags || []).forEach((t) => tags.append(el("span", "tag", t)));

  const like = el("button", "like");
  like.type = "button";
  like.innerHTML = HEART;
  const num = el("span", null, likeCount);
  like.append(num);
  setLikeState(like, likedIds.includes(p.id));
  like.addEventListener("click", () => pressLike(p.id, like, num));

  foot.append(tags, like);
  card.append(open, foot);
  return card;
}

function setLikeState(button, liked) {
  button.classList.toggle("liked", liked);
  button.setAttribute("aria-pressed", liked ? "true" : "false");
  button.setAttribute("aria-label", liked ? "좋아요를 눌렀습니다" : "좋아요");
}

async function pressLike(projectId, button, num) {
  if (likedIds.includes(projectId) || button.disabled) return;
  button.disabled = true;
  try {
    const res = await post("likes", { project_id: projectId, client_id: clientId });
    if (res.ok) {
      num.textContent = Number(num.textContent) + 1;
      rememberLiked(projectId);
      setLikeState(button, true);
    } else if (res.status === 409) {
      // 이 브라우저가 예전에 이미 누른 카드
      rememberLiked(projectId);
      setLikeState(button, true);
    } else {
      throw new Error(`${res.status} ${await res.text()}`);
    }
  } catch (e) {
    console.error("좋아요를 남기지 못했습니다:", e);
    alert("좋아요를 남기지 못했습니다. 잠시 후 다시 눌러 주세요.");
  } finally {
    button.disabled = false;
  }
}

// ===== 방명록 =====
function formatDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeGuestbookItem(row) {
  const li = el("li", "gb-item");
  const head = el("div", "gb-head");
  head.append(el("span", "gb-nick", row.nickname), el("span", "gb-date", formatDate(row.created_at)));
  li.append(head, el("p", "gb-text", row.message));
  return li;
}

function showEmptyGuestbook() {
  $("gb-list").replaceChildren(el("li", "empty", "아직 남겨진 글이 없습니다. 첫 글을 남겨 주세요."));
}

async function loadGuestbook() {
  try {
    const rows = await get("resume_guestbook?select=*&order=created_at.desc");
    if (rows.length === 0) {
      showEmptyGuestbook();
      return;
    }
    $("gb-list").replaceChildren(...rows.map(makeGuestbookItem));
  } catch (e) {
    console.error("방명록을 불러오지 못했습니다:", e);
    $("gb-list").replaceChildren(el("li", "empty", "방명록을 불러오지 못했습니다."));
  }
}

async function submitGuestbook() {
  const nickname = $("gb-nickname").value.trim();
  const message = $("gb-message").value.trim();
  const status = $("gb-status");
  const button = $("gb-submit");

  if (!nickname || !message) {
    status.textContent = "별명과 한마디를 모두 적어 주세요.";
    return;
  }

  button.disabled = true;
  status.textContent = "남기는 중...";
  try {
    const res = await post("resume_guestbook", { nickname, message });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const [row] = await res.json();

    const list = $("gb-list");
    const empty = list.querySelector(".empty");
    if (empty) empty.remove();
    list.prepend(makeGuestbookItem(row));

    $("gb-nickname").value = "";
    $("gb-message").value = "";
    status.textContent = "남겼습니다. 고맙습니다!";
  } catch (e) {
    console.error("방명록을 남기지 못했습니다:", e);
    status.textContent = "남기지 못했습니다. 잠시 후 다시 시도해 주세요.";
  } finally {
    button.disabled = false;
  }
}

$("gb-submit").addEventListener("click", submitGuestbook);

// ===== 시작 =====
loadProfile();
loadProjects();
loadGuestbook();
