// ===== Supabase 연결 정보 (공개 키만 넣는다) =====
const SUPABASE_URL = "https://yqozyohpkshffspwjupi.supabase.co";
const SUPABASE_KEY = "sb_publishable_jvU2x-aKL4WIXfSLQhtRgQ_gddA-VPF";
const BUCKET = "resume";

// 올릴 수 있는 파일 종류와 크기
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const FILE_TYPES = { ...IMAGE_TYPES, "application/pdf": "pdf" };

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

function button(text, className, onClick) {
  const b = el("button", className, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function showMsg(id, text, isError) {
  const m = $(id);
  m.textContent = text;
  m.classList.toggle("error", Boolean(isError));
}

function formatDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ===== 로그인 정보 보관 =====
let session = null; // { access_token, refresh_token, expires_at, email }

function saveSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    email: data.user ? data.user.email : session && session.email,
  };
  try {
    localStorage.setItem("resume_admin_session", JSON.stringify(session));
  } catch (e) {
    // 저장이 막힌 브라우저에서는 새로고침하면 다시 로그인해야 한다
  }
}

function loadSession() {
  try {
    session = JSON.parse(localStorage.getItem("resume_admin_session"));
  } catch (e) {
    session = null;
  }
}

function clearSession() {
  session = null;
  try {
    localStorage.removeItem("resume_admin_session");
  } catch (e) {
    // 무시
  }
}

// ===== Supabase Auth (로그인·토큰 새로 받기·로그아웃) =====
async function authRequest(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || `${res.status}`);
  return data;
}

async function refreshSession() {
  if (!session || !session.refresh_token) throw new Error("로그인이 필요합니다");
  const data = await authRequest("token?grant_type=refresh_token", {
    refresh_token: session.refresh_token,
  });
  saveSession(data);
}

// 토큰이 1분 안에 끝나면 미리 새로 받는다
async function getToken() {
  if (!session) throw new Error("로그인이 필요합니다");
  if (session.expires_at - 60 < Date.now() / 1000) await refreshSession();
  return session.access_token;
}

// ===== 로그인한 사람의 토큰으로 Supabase 부르기 =====
async function api(url, options = {}, retried = false) {
  const token = await getToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  // 토큰이 만료됐으면 한 번만 새로 받아 다시 시도
  if (res.status === 401 && !retried) {
    try {
      await refreshSession();
    } catch (e) {
      logout();
      throw e;
    }
    return api(url, options, true);
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res;
}

// 표 부르기. 결과 줄들을 배열로 돌려준다.
async function db(path, method = "GET", body) {
  const options = {
    method,
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  const res = await api(`${SUPABASE_URL}/rest/v1/${path}`, options);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// 고치거나 지운 줄이 하나도 없으면 권한이 없는 것
function mustChange(rows) {
  if (!rows.length) throw new Error("바뀐 것이 없습니다. 관리자 권한을 확인해 주세요.");
  return rows;
}

// ===== 파일 올리기 (resume 보관함) =====
// 문제가 있으면 안내 문구를, 괜찮으면 빈 글자를 돌려준다
function checkFile(file, allowed) {
  if (!allowed[file.type]) {
    return allowed === IMAGE_TYPES
      ? "이미지 파일(png, jpg, webp, gif)만 올릴 수 있어요."
      : "이미지(png, jpg, webp, gif)나 PDF 파일만 올릴 수 있어요.";
  }
  if (file.size > MAX_SIZE) return "10MB가 넘는 파일은 올릴 수 없어요.";
  return "";
}

// 파일 이름은 영어·숫자로 새로 짓는다 (예: projects/1730000000000-k3j9x2.pdf)
function newFileName(folder, file, allowed) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${folder}/${Date.now()}-${random}.${allowed[file.type]}`;
}

async function uploadFile(folder, file, allowed) {
  const path = newFileName(folder, file, allowed);
  await api(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { "Content-Type": file.type, "x-upsert": "false" },
    body: file,
  });
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// ===== 화면 바꾸기 =====
function showScreen(name) {
  $("login-panel").hidden = name !== "login";
  $("not-admin-panel").hidden = name !== "not-admin";
  $("admin-area").hidden = name !== "admin";
  $("logout-btn").hidden = name === "login";
  $("who").textContent = name === "login" || !session ? "" : session.email || "";
}

async function login() {
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) {
    showMsg("login-msg", "이메일과 비밀번호를 적어 주세요.", true);
    return;
  }
  $("login-btn").disabled = true;
  showMsg("login-msg", "로그인하는 중...");
  try {
    const data = await authRequest("token?grant_type=password", { email, password });
    saveSession(data);
    $("login-password").value = "";
    showMsg("login-msg", "");
    await start();
  } catch (e) {
    console.error("로그인 실패:", e);
    showMsg("login-msg", "로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요.", true);
  } finally {
    $("login-btn").disabled = false;
  }
}

function logout() {
  if (session) {
    // 서버 쪽 로그인도 끝낸다 (실패해도 이 브라우저에서는 로그아웃)
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {});
  }
  clearSession();
  showScreen("login");
}

// 로그인한 사람이 admins 표에 있는지 확인하고 알맞은 화면을 보여 준다
async function start() {
  loadSession();
  if (!session) {
    showScreen("login");
    return;
  }
  try {
    const rows = await db("admins?select=user_id");
    if (rows.length === 0) {
      showScreen("not-admin");
      return;
    }
    showScreen("admin");
    loadProfile();
    loadProjectsAndLikes();
    loadGuestbook();
  } catch (e) {
    console.error("로그인 확인 실패:", e);
    clearSession();
    showScreen("login");
  }
}

// ===== 프로필 =====
const PROFILE_FIELDS = [
  "name", "title", "career_badge", "email", "phone", "location",
  "headline", "intro", "education", "skills", "experience", "quote", "photo_url",
];

function showPhotoPreview(url) {
  const box = $("photo-preview");
  box.replaceChildren();
  if (url) {
    const img = el("img");
    img.src = url;
    img.alt = "";
    box.append(img);
  }
}

async function loadProfile() {
  try {
    const rows = await db("profile?select=*&id=eq.1");
    const p = rows[0] || {};
    PROFILE_FIELDS.forEach((f) => {
      $(`pf-${f}`).value = p[f] || "";
    });
    showPhotoPreview(p.photo_url);
  } catch (e) {
    console.error(e);
    showMsg("profile-msg", "프로필을 불러오지 못했어요.", true);
  }
}

function profileFromForm() {
  const row = { id: 1, updated_at: new Date().toISOString() };
  PROFILE_FIELDS.forEach((f) => {
    row[f] = $(`pf-${f}`).value.trim();
  });
  row.photo_url = row.photo_url || null;
  return row;
}

async function saveProfile() {
  $("profile-save").disabled = true;
  showMsg("profile-msg", "저장하는 중...");
  try {
    // 줄이 있으면 고치고, 없으면 새로 만든다
    const row = profileFromForm();
    const updated = await db("profile?id=eq.1", "PATCH", row);
    if (!updated.length) mustChange(await db("profile", "POST", row));
    showMsg("profile-msg", "저장했어요. 방문자 화면을 새로고침하면 보여요.");
  } catch (e) {
    console.error(e);
    showMsg("profile-msg", "저장하지 못했어요.", true);
  } finally {
    $("profile-save").disabled = false;
  }
}

async function uploadPhoto() {
  const input = $("photo-file");
  const file = input.files[0];
  if (!file) return;
  const problem = checkFile(file, IMAGE_TYPES);
  if (problem) {
    showMsg("profile-msg", problem, true);
    input.value = "";
    return;
  }
  showMsg("profile-msg", "사진을 올리는 중...");
  try {
    const url = await uploadFile("profile", file, IMAGE_TYPES);
    mustChange(await db("profile?id=eq.1", "PATCH", { photo_url: url, updated_at: new Date().toISOString() }));
    $("pf-photo_url").value = url;
    showPhotoPreview(url);
    showMsg("profile-msg", "사진을 올리고 저장했어요.");
  } catch (e) {
    console.error(e);
    showMsg("profile-msg", "사진을 올리지 못했어요. 먼저 '프로필 저장'을 한 번 눌러 보세요.", true);
  } finally {
    input.value = "";
  }
}

async function clearPhoto() {
  if (!confirm("프로필 사진을 빼시겠어요? (방문자 화면에 회색 자리 표시가 나와요)")) return;
  try {
    mustChange(await db("profile?id=eq.1", "PATCH", { photo_url: null, updated_at: new Date().toISOString() }));
    $("pf-photo_url").value = "";
    showPhotoPreview(null);
    showMsg("profile-msg", "사진을 뺐어요.");
  } catch (e) {
    console.error(e);
    showMsg("profile-msg", "사진을 빼지 못했어요.", true);
  }
}

// ===== 포트폴리오 카드와 좋아요 =====
let projects = [];
let likeCounts = {};
let editingId = null; // 수정 중인 카드 번호 (없으면 새 카드 추가)

async function loadProjectsAndLikes() {
  try {
    const [rows, likes] = await Promise.all([
      db("projects?select=*&order=sort_order.asc,id.asc"),
      db("likes?select=project_id&limit=100000"),
    ]);
    projects = rows;
    likeCounts = {};
    likes.forEach((l) => {
      likeCounts[l.project_id] = (likeCounts[l.project_id] || 0) + 1;
    });
    renderProjects();
    renderLikes();
  } catch (e) {
    console.error(e);
    $("project-list").replaceChildren(el("li", "empty", "카드를 불러오지 못했어요."));
    $("like-list").replaceChildren(el("li", "empty", "좋아요를 불러오지 못했어요."));
  }
}

function renderProjects() {
  const list = $("project-list");
  list.replaceChildren();
  if (projects.length === 0) {
    list.append(el("li", "empty", "아직 카드가 없어요. 위에서 추가해 보세요."));
    return;
  }
  projects.forEach((p, i) => {
    const li = el("li", "row");
    if (p.id === editingId) li.classList.add("editing");

    const thumb = el("div", "row-thumb");
    if (p.thumbnail_url) {
      const img = el("img");
      img.src = p.thumbnail_url;
      img.alt = "";
      thumb.append(img);
    }

    const main = el("div", "row-main");
    main.append(
      el("div", "row-meta", [p.number, p.category].filter(Boolean).join(" · ")),
      el("div", "row-title", p.title),
      el("div", "row-sub", `태그: ${(p.tags || []).join(", ") || "없음"} · 첨부 파일: ${p.file_url ? "있음" : "없음"}`)
    );
    const likes = el("div", "row-sub");
    likes.append("좋아요 ", el("span", "count", `♥ ${likeCounts[p.id] || 0}`));
    main.append(likes);

    const btns = el("div", "row-buttons");
    const up = button("올리기", "btn line small", () => moveProject(i, -1));
    const down = button("내리기", "btn line small", () => moveProject(i, 1));
    up.disabled = i === 0;
    down.disabled = i === projects.length - 1;
    btns.append(
      up,
      down,
      button("수정", "btn line small", () => startEdit(p)),
      button("삭제", "btn danger small", () => deleteProject(p))
    );

    li.append(thumb, main, btns);
    list.append(li);
  });
}

function renderLikes() {
  const list = $("like-list");
  list.replaceChildren();
  if (projects.length === 0) {
    list.append(el("li", "empty", "카드가 없어요."));
    return;
  }
  projects.forEach((p) => {
    const li = el("li", "row");
    const main = el("div", "row-main");
    main.append(el("div", "row-title", p.title));
    const count = el("div", "count", `♥ ${likeCounts[p.id] || 0}`);
    const reset = button("좋아요 초기화", "btn danger small", () => resetLikes(p));
    reset.disabled = !likeCounts[p.id];
    li.append(main, count, reset);
    list.append(li);
  });
}

// 폼 비우기 (새 카드 추가 모드)
function resetProjectForm() {
  editingId = null;
  ["number", "category", "title", "description", "tags", "thumbnail_url", "file_url"].forEach((f) => {
    $(`pj-${f}`).value = "";
  });
  $("project-form-title").textContent = "카드 추가";
  $("project-save").textContent = "카드 추가";
  $("project-cancel").hidden = true;
  renderProjects();
}

function startEdit(p) {
  editingId = p.id;
  $("pj-number").value = p.number || "";
  $("pj-category").value = p.category || "";
  $("pj-title").value = p.title || "";
  $("pj-description").value = p.description || "";
  $("pj-tags").value = (p.tags || []).join(", ");
  $("pj-thumbnail_url").value = p.thumbnail_url || "";
  $("pj-file_url").value = p.file_url || "";
  $("project-form-title").textContent = `카드 수정: ${p.title}`;
  $("project-save").textContent = "수정 저장";
  $("project-cancel").hidden = false;
  showMsg("project-msg", "");
  renderProjects();
  $("project-form-title").scrollIntoView({ behavior: "smooth" });
}

function projectFromForm() {
  return {
    number: $("pj-number").value.trim(),
    category: $("pj-category").value.trim(),
    title: $("pj-title").value.trim(),
    description: $("pj-description").value.trim(),
    tags: $("pj-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
    thumbnail_url: $("pj-thumbnail_url").value || null,
    file_url: $("pj-file_url").value || null,
  };
}

async function saveProject() {
  const row = projectFromForm();
  if (!row.title) {
    showMsg("project-msg", "제목을 적어 주세요.", true);
    return;
  }
  $("project-save").disabled = true;
  showMsg("project-msg", "저장하는 중...");
  try {
    if (editingId) {
      mustChange(await db(`projects?id=eq.${editingId}`, "PATCH", row));
      showMsg("project-msg", "카드를 고쳤어요.");
    } else {
      const last = projects[projects.length - 1];
      row.sort_order = last ? last.sort_order + 1 : 1;
      mustChange(await db("projects", "POST", row));
      showMsg("project-msg", "카드를 추가했어요. 목록 맨 아래에 있어요.");
    }
    resetProjectForm();
    await loadProjectsAndLikes();
  } catch (e) {
    console.error(e);
    showMsg("project-msg", "저장하지 못했어요.", true);
  } finally {
    $("project-save").disabled = false;
  }
}

async function deleteProject(p) {
  if (!confirm(`"${p.title}" 카드를 지우시겠어요?\n이 카드의 좋아요도 함께 지워지고, 되돌릴 수 없어요.`)) return;
  try {
    mustChange(await db(`projects?id=eq.${p.id}`, "DELETE"));
    if (editingId === p.id) resetProjectForm();
    showMsg("project-msg", "카드를 지웠어요.");
    await loadProjectsAndLikes();
  } catch (e) {
    console.error(e);
    showMsg("project-msg", "카드를 지우지 못했어요.", true);
  }
}

// 순서 바꾸기: 바꾼 뒤 전체를 1, 2, 3... 으로 다시 매기고 달라진 카드만 저장
async function moveProject(index, step) {
  const target = index + step;
  if (target < 0 || target >= projects.length) return;
  const order = projects.slice();
  [order[index], order[target]] = [order[target], order[index]];
  try {
    const changes = order
      .map((p, i) => ({ p, sort: i + 1 }))
      .filter(({ p, sort }) => p.sort_order !== sort);
    for (const { p, sort } of changes) {
      mustChange(await db(`projects?id=eq.${p.id}`, "PATCH", { sort_order: sort }));
    }
    await loadProjectsAndLikes();
  } catch (e) {
    console.error(e);
    showMsg("project-msg", "순서를 바꾸지 못했어요.", true);
    await loadProjectsAndLikes();
  }
}

async function uploadProjectFile(inputId, urlId, allowed) {
  const input = $(inputId);
  const file = input.files[0];
  if (!file) return;
  const problem = checkFile(file, allowed);
  if (problem) {
    showMsg("project-msg", problem, true);
    input.value = "";
    return;
  }
  showMsg("project-msg", "파일을 올리는 중...");
  try {
    $(urlId).value = await uploadFile("projects", file, allowed);
    showMsg("project-msg", `파일을 올렸어요. '${$("project-save").textContent}'를 눌러야 카드에 저장돼요.`);
  } catch (e) {
    console.error(e);
    showMsg("project-msg", "파일을 올리지 못했어요.", true);
  } finally {
    input.value = "";
  }
}

async function resetLikes(p) {
  if (!confirm(`"${p.title}" 카드의 좋아요 ${likeCounts[p.id] || 0}개를 모두 지우시겠어요?\n되돌릴 수 없어요.`)) return;
  try {
    await db(`likes?project_id=eq.${p.id}`, "DELETE");
    await loadProjectsAndLikes();
    if (likeCounts[p.id]) alert("좋아요를 지우지 못했어요. 관리자 권한을 확인해 주세요.");
  } catch (e) {
    console.error(e);
    alert("좋아요를 지우지 못했어요.");
  }
}

// ===== 방명록 =====
async function loadGuestbook() {
  const list = $("guestbook-list");
  try {
    const rows = await db("resume_guestbook?select=*&order=created_at.desc");
    list.replaceChildren();
    if (rows.length === 0) {
      list.append(el("li", "empty", "아직 방명록 글이 없어요."));
      return;
    }
    rows.forEach((g) => {
      const li = el("li", "row");
      const main = el("div", "row-main");
      main.append(
        el("div", "row-title", g.nickname),
        el("div", "row-sub", g.message),
        el("div", "gb-date", formatDate(g.created_at))
      );
      li.append(main, button("삭제", "btn danger small", () => deleteGuestbook(g)));
      list.append(li);
    });
  } catch (e) {
    console.error(e);
    list.replaceChildren(el("li", "empty", "방명록을 불러오지 못했어요."));
  }
}

async function deleteGuestbook(g) {
  if (!confirm(`${g.nickname} 님의 글을 지우시겠어요?\n"${g.message}"\n되돌릴 수 없어요.`)) return;
  try {
    mustChange(await db(`resume_guestbook?id=eq.${g.id}`, "DELETE"));
    await loadGuestbook();
  } catch (e) {
    console.error(e);
    alert("글을 지우지 못했어요.");
  }
}

// ===== 버튼 연결 =====
$("login-btn").addEventListener("click", login);
$("login-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});
$("logout-btn").addEventListener("click", logout);

$("profile-save").addEventListener("click", saveProfile);
$("photo-file").addEventListener("change", uploadPhoto);
$("photo-clear").addEventListener("click", clearPhoto);

$("project-save").addEventListener("click", saveProject);
$("project-cancel").addEventListener("click", () => {
  resetProjectForm();
  showMsg("project-msg", "");
});
$("pj-thumb-file").addEventListener("change", () => uploadProjectFile("pj-thumb-file", "pj-thumbnail_url", IMAGE_TYPES));
$("pj-file-file").addEventListener("change", () => uploadProjectFile("pj-file-file", "pj-file_url", FILE_TYPES));
$("pj-thumb-clear").addEventListener("click", () => {
  $("pj-thumbnail_url").value = "";
});
$("pj-file-clear").addEventListener("click", () => {
  $("pj-file_url").value = "";
});

// ===== 시작 =====
start();
