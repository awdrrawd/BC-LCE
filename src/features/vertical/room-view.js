import { T } from '../../core/i18n.js';
import { getRoomRelations } from './relations.js';
import { joinSearchRoom } from '../../game/room-search.js';
const bcText = k => typeof TextGet === 'function' ? (TextGet(k) || k) : k;

function buildRoomTags(room) {
    const tags = [];
    if (room.Space !== undefined && typeof ChatSearchGetSpaceName === 'function') {
        tags.push(ChatSearchGetSpaceName(room.Space));
    }
    if (room.Language && typeof ChatSearchGetLanguageName === 'function') {
        tags.push(ChatSearchGetLanguageName(room.Language));
    }
    if (room.Game) tags.push(bcText(room.Game));
    if (room.MapType && room.MapType !== 'Never' && typeof ChatSearchGetRoomTypeName === 'function') {
        tags.push(ChatSearchGetRoomTypeName(room.MapType));
    }
    if (Array.isArray(room.BlockCategory)) {
        for (const b of room.BlockCategory) tags.push(T('v_csh_block_prefix') + bcText(b));
    }
    if (Array.isArray(room.Access)) {
        for (const a of room.Access) {
            if (a === 'All') continue;
            tags.push(T('v_csh_access_prefix') + bcText(a + 'Access'));
        }
    }
    return tags;
}

export function buildRoomCard(room) {
    const name = room.Name || T('v_room_unnamed');
    const memberCount = room.MemberCount ?? null;
    const limit = room.MemberLimit ?? null;
    const isFull = memberCount !== null && limit !== null && memberCount >= limit;
    const hasFriend = Array.isArray(room.Friends) && room.Friends.length > 0;

    const card = document.createElement('div');
    card.className = 'lce-csh-card' + (isFull ? ' full' : '') + (hasFriend ? ' has-friend' : '');

    const top = document.createElement('div');
    top.className = 'lce-csh-card-top';
    if (!room.CanJoin) {
        const lockEl = document.createElement('span');
        lockEl.className = 'lce-csh-card-lock';
        lockEl.textContent = '🔒';
        top.appendChild(lockEl);
    }
    const nameEl = document.createElement('div');
    nameEl.className = 'lce-csh-card-name';
    nameEl.textContent = name;
    top.appendChild(nameEl);
    card.appendChild(top);

    const infoBtn = document.createElement('button');
    infoBtn.className = 'lce-csh-card-info';
    infoBtn.textContent = 'ⓘ';
    infoBtn.setAttribute('aria-label', T('v_room_info_aria'));
    infoBtn.addEventListener('click', (e) => { e.stopPropagation(); cshShowRoomInfo(room); });
    card.appendChild(infoBtn);

    if (room.Creator) {
        const ownerEl = document.createElement('div');
        ownerEl.className = 'lce-csh-card-owner';
        ownerEl.textContent = T('v_room_by_prefix') + room.Creator;
        card.appendChild(ownerEl);
    }
    if (room.Description) {
        const descEl = document.createElement('div');
        descEl.className = 'lce-csh-card-desc';
        descEl.textContent = room.Description;
        card.appendChild(descEl);
    }

    const foot = document.createElement('div');
    foot.className = 'lce-csh-card-foot';
    const cnt = document.createElement('span');
    cnt.className = 'lce-csh-card-count' + (isFull ? ' full' : '');
    cnt.textContent = memberCount !== null ? `👥 ${memberCount}${limit !== null ? '/' + limit : ''}` : '';
    foot.appendChild(cnt);

    // 同一種關係只顯示一個標籤，但不同關係都要顯示
    for (const relType of new Set(getRoomRelations(room).map(p => p.relation))) {
        const rel = document.createElement('span');
        rel.className = `lce-csh-card-rel ${relType}`;
        const dot = document.createElement('span');
        dot.className = 'dot';
        const text = document.createElement('span');
        text.textContent = T(`v_rel_${relType}`);
        rel.append(dot, text);
        foot.appendChild(rel);
    }
    card.appendChild(foot);

    card.addEventListener('click', () => {
        joinSearchRoom(room);
    });
    return card;
}

export function cshCloseRoomInfo() {
    document.getElementById('lce-csh-info-backdrop')?.remove();
}

function cshShowRoomInfo(room) {
    cshCloseRoomInfo();

    const backdrop = document.createElement('div');
    backdrop.id = 'lce-csh-info-backdrop';
    backdrop.addEventListener('click', cshCloseRoomInfo);
    // 擋掉 pointer 事件，否則會被下層的翻頁滑動接走
    for (const t of ['pointerdown', 'pointermove', 'pointerup']) {
        backdrop.addEventListener(t, (e) => e.stopPropagation());
    }

    const sheet = document.createElement('div');
    sheet.id = 'lce-csh-info-sheet';
    sheet.addEventListener('click', (e) => e.stopPropagation());

    const handle = document.createElement('div');
    handle.id = 'lce-csh-info-handle';
    sheet.appendChild(handle);

    const head = document.createElement('div');
    head.id = 'lce-csh-info-head';
    const main = document.createElement('div');
    main.id = 'lce-csh-info-main';
    const title = document.createElement('div');
    title.id = 'lce-csh-info-title';
    title.textContent = room.Name || T('v_room_unnamed');
    const ownerEl = document.createElement('div');
    ownerEl.id = 'lce-csh-info-owner';
    ownerEl.textContent = room.Creator ? T('v_room_by_prefix') + room.Creator : '';
    main.append(title, ownerEl);

    const closeBtn = document.createElement('button');
    closeBtn.id = 'lce-csh-info-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', cshCloseRoomInfo);
    head.append(main, closeBtn);
    sheet.appendChild(head);

    const descEl = document.createElement('div');
    descEl.id = 'lce-csh-info-desc';
    descEl.textContent = room.Description || T('v_room_no_desc');
    sheet.appendChild(descEl);

    const tagsWrap = document.createElement('div');
    tagsWrap.id = 'lce-csh-info-tags';
    for (const tagText of buildRoomTags(room)) {
        const tag = document.createElement('div');
        tag.className = 'lce-csh-tag';
        tag.textContent = tagText;
        tagsWrap.appendChild(tag);
    }
    sheet.appendChild(tagsWrap);

    const people = getRoomRelations(room);
    if (people.length) {
        const peopleWrap = document.createElement('div');
        peopleWrap.id = 'lce-csh-info-people';
        for (const p of people) {
            const row = document.createElement('div');
            row.className = 'lce-csh-info-person';
            const dot = document.createElement('span');
            dot.className = `lce-csh-rel-dot ${p.relation}`;
            const name = document.createElement('span');
            name.textContent = p.memberName;
            const label = document.createElement('span');
            label.className = 'lce-csh-rel-label';
            label.textContent = T(`v_rel_${p.relation}`);
            row.append(dot, name, label);
            peopleWrap.appendChild(row);
        }
        sheet.appendChild(peopleWrap);
    }

    const footer = document.createElement('div');
    footer.id = 'lce-csh-info-footer';
    const members = document.createElement('div');
    members.id = 'lce-csh-info-members';
    members.textContent = `${room.MemberCount ?? 0} / ${room.MemberLimit ?? '?'}`;

    const canJoin = !!(room.CanJoin && (room.MemberCount ?? 0) < (room.MemberLimit ?? 999));
    const joinBtn2 = document.createElement('button');
    joinBtn2.id = 'lce-csh-info-join';
    joinBtn2.textContent = T(canJoin ? 'v_room_can_join' : 'v_room_cannot_join');
    if (!canJoin) joinBtn2.classList.add('disabled');
    joinBtn2.addEventListener('click', () => {
        if (!canJoin) return;
        cshCloseRoomInfo();
        joinSearchRoom(room);
    });

    footer.append(members, joinBtn2);
    sheet.appendChild(footer);

    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);
}

