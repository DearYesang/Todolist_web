<script>
    import { onMount } from 'svelte';
    import { authClient } from '$lib/client/auth-client.js';
    import {
        createRecoveryCodes,
        requestEmailVerificationCode,
        revokeRecoveryCodes
    } from '$lib/client/account-security-api.js';
    import {
        deleteUserPasskey,
        listUserPasskeys,
        updateUserPasskeyName
    } from '$lib/client/passkey-management-api.js';
    import { clearOfflineWriteQueue, getOfflineQueueSize } from '$lib/client/offline-write-queue.js';
    import { clearLocalTaskCache } from '$lib/client/task-store.js';

    const session = authClient.useSession();

    let email = $state('');
    let name = $state('');
    let emailVerificationCode = $state('');
    let verificationEmail = $state('');
    let verificationExpiresAt = $state('');
    let recoveryCode = $state('');
    let passkeyName = $state(createSuggestedPasskeyName());
    let isRecoveryMode = $state(false);
    let isWorking = $state(false);
    let authMessage = $state('');
    let authError = $state('');
    let recoverySummary = $state(/** @type {import('$lib/client/account-security-api.js').RecoveryCodeSummary | null} */ (null));
    let newRecoveryCodes = $state(/** @type {string[]} */ ([]));
    let passkeyManagerOpen = $state(false);
    let passkeyListLoading = $state(false);
    let passkeyListError = $state('');
    let passkeyDrafts = $state(/** @type {Record<string, string>} */ ({}));
    let managedPasskeys = $state(/** @type {import('$lib/client/passkey-management-api.js').ManagedPasskey[]} */ ([]));
    let clearLocalDataOnSignOut = $state(true);

    onMount(() => {
        passkeyName = createSuggestedPasskeyName();
    });

    $effect(() => {
        if (!$session.data?.user) {
            passkeyManagerOpen = false;
            managedPasskeys = [];
            passkeyDrafts = {};
            passkeyListError = '';
        }
    });

    async function sendVerificationCode() {
        if (isWorking) return;

        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail) {
            authError = '이메일을 입력해 주세요.';
            return;
        }

        authMessage = '';
        authError = '';
        isWorking = true;

        try {
            const result = await requestEmailVerificationCode({
                email: normalizedEmail,
                name: name.trim() || normalizedEmail
            });
            if (!result.ok) {
                authError = getAuthErrorMessage(result);
                return;
            }

            emailVerificationCode = '';
            verificationEmail = result.email;
            verificationExpiresAt = result.expiresAt;
            authMessage = result.previewCode
                ? `확인 코드: ${result.previewCode}`
                : '새 확인 코드를 보냈습니다. 가장 최근 코드만 사용할 수 있습니다.';
        } finally {
            isWorking = false;
        }
    }

    async function registerPasskey() {
        if (isWorking) return;

        const normalizedEmail = email.trim().toLowerCase();
        if (!$session.data?.user && !normalizedEmail) {
            authError = '이메일을 입력해 주세요.';
            return;
        }
        if (!$session.data?.user && !isRecoveryMode && !emailVerificationCode.trim()) {
            authError = '이메일 확인 코드를 입력해 주세요.';
            return;
        }
        if (!$session.data?.user && !isRecoveryMode && verificationEmail && verificationEmail !== normalizedEmail) {
            authError = '현재 이메일로 새 확인 코드를 받아 주세요.';
            return;
        }
        if (!$session.data?.user && !isRecoveryMode && isExpiredVerificationCode()) {
            authError = '확인 코드가 만료되었습니다. 새 코드를 받아 주세요.';
            return;
        }
        if (!$session.data?.user && isRecoveryMode && !recoveryCode.trim()) {
            authError = '복구 코드를 입력해 주세요.';
            return;
        }

        authMessage = '';
        authError = '';
        isWorking = true;

        try {
            const selectedPasskeyName = passkeyName.trim() || createSuggestedPasskeyName();
            const result = await authClient.passkey.addPasskey({
                name: selectedPasskeyName,
                authenticatorAttachment: 'platform',
                context: $session.data?.user
                    ? null
                    : JSON.stringify({
                        email: normalizedEmail,
                        name: name.trim() || normalizedEmail,
                        ...(isRecoveryMode
                            ? { recoveryCode: recoveryCode.trim() }
                            : { emailVerificationCode: emailVerificationCode.trim() })
                    })
            });

            if (result.error) {
                authError = getAuthErrorMessage(result.error);
                return;
            }

			authMessage = '패스키가 등록되었습니다.';
            passkeyName = createSuggestedPasskeyName();
			if (!$session.data?.user) {
				isWorking = false;
				await signInPasskey();
			} else {
				await $session.refetch();
                if (passkeyManagerOpen) {
                    await loadPasskeys();
                }
			}
        } finally {
            isWorking = false;
        }
    }

    async function signInPasskey() {
        if (isWorking) return;

        authMessage = '';
        authError = '';
        isWorking = true;

        try {
            const result = await authClient.signIn.passkey();
            if (result.error) {
                authError = getAuthErrorMessage(result.error);
                return;
            }

            authMessage = '로그인되었습니다.';
            await $session.refetch();
        } finally {
            isWorking = false;
        }
    }

    async function signOut() {
        if (isWorking) return;

        authMessage = '';
        authError = '';
        if (clearLocalDataOnSignOut && !confirmLocalDataClear()) {
            authMessage = '로그아웃을 취소했습니다. 먼저 Sync로 오프라인 변경을 동기화해 주세요.';
            return;
        }
        isWorking = true;

        try {
            const result = await authClient.signOut();
            if (result.error) {
                authError = getAuthErrorMessage(result.error);
                return;
            }

            authMessage = '로그아웃되었습니다.';
            if (clearLocalDataOnSignOut) {
                clearOfflineWriteQueue();
                clearLocalTaskCache();
                authMessage = '로그아웃했고 이 기기의 오프라인 캐시를 삭제했습니다.';
            }
            recoverySummary = null;
            newRecoveryCodes = [];
            clearVerificationState();
            await $session.refetch();
        } finally {
            isWorking = false;
        }
    }

    function confirmLocalDataClear() {
        const pendingChanges = getOfflineQueueSize();
        if (pendingChanges < 1) {
            return true;
        }

        if (typeof window === 'undefined') {
            return false;
        }

        return window.confirm(
            `아직 동기화되지 않은 오프라인 변경 ${pendingChanges}건이 있습니다. 로그아웃하면서 이 기기 캐시를 삭제할까요?`
        );
    }

    async function generateRecoveryCodes() {
        if (isWorking) return;

        authMessage = '';
        authError = '';
        isWorking = true;

        try {
            const result = await createRecoveryCodes();
            if (!result.ok) {
                authError = getAuthErrorMessage(result);
                return;
            }

            recoverySummary = result.summary;
            newRecoveryCodes = result.codes ?? [];
            authMessage = '새 복구 코드가 생성되었습니다.';
        } finally {
            isWorking = false;
        }
    }

    async function deleteRecoveryCodes() {
        if (isWorking) return;

        authMessage = '';
        authError = '';
        isWorking = true;

        try {
            const result = await revokeRecoveryCodes();
            if (!result.ok) {
                authError = getAuthErrorMessage(result);
                return;
            }

            recoverySummary = result.summary;
            newRecoveryCodes = [];
            authMessage = '복구 코드가 폐기되었습니다.';
        } finally {
            isWorking = false;
        }
    }

    async function togglePasskeyManager() {
        passkeyManagerOpen = !passkeyManagerOpen;
        if (passkeyManagerOpen) {
            await loadPasskeys();
        }
    }

    async function loadPasskeys() {
        if (passkeyListLoading) return;

        passkeyListError = '';
        passkeyListLoading = true;

        try {
            const result = await listUserPasskeys();
            if (!result.ok) {
                passkeyListError = getAuthErrorMessage(result);
                return;
            }

            managedPasskeys = result.passkeys;
            passkeyDrafts = Object.fromEntries(
                result.passkeys.map((passkey) => [passkey.id, passkey.name || createFallbackPasskeyName(passkey)])
            );
        } finally {
            passkeyListLoading = false;
        }
    }

    /**
     * @param {import('$lib/client/passkey-management-api.js').ManagedPasskey} passkey
     */
    async function saveManagedPasskeyName(passkey) {
        if (isWorking) return;

        const nextName = (passkeyDrafts[passkey.id] ?? '').trim();
        if (!nextName) {
            authError = '패스키 이름을 입력해 주세요.';
            return;
        }

        authMessage = '';
        authError = '';
        isWorking = true;

        try {
            const result = await updateUserPasskeyName(passkey.id, nextName);
            if (!result.ok) {
                authError = getAuthErrorMessage(result);
                return;
            }

            managedPasskeys = managedPasskeys.map((item) => item.id === passkey.id ? result.passkey : item);
            passkeyDrafts = { ...passkeyDrafts, [result.passkey.id]: result.passkey.name || nextName };
            authMessage = '패스키 이름을 저장했습니다. Apple 선택 화면은 기존 이름을 계속 표시할 수 있습니다.';
        } finally {
            isWorking = false;
        }
    }

    /**
     * @param {import('$lib/client/passkey-management-api.js').ManagedPasskey} passkey
     */
    async function removeManagedPasskey(passkey) {
        if (isWorking) return;

        if (managedPasskeys.length <= 1) {
            authError = '마지막 패스키는 삭제하지 않는 것이 안전합니다. 새 패스키를 먼저 추가해 주세요.';
            return;
        }

        const label = passkey.name || createFallbackPasskeyName(passkey);
        if (!confirm(`${label} 패스키를 삭제하시겠습니까? 이 기기로는 다시 로그인할 수 없을 수 있습니다.`)) {
            return;
        }

        authMessage = '';
        authError = '';
        isWorking = true;

        try {
            const result = await deleteUserPasskey(passkey.id);
            if (!result.ok) {
                authError = getAuthErrorMessage(result);
                return;
            }

            managedPasskeys = managedPasskeys.filter((item) => item.id !== passkey.id);
            const { [passkey.id]: _deleted, ...nextDrafts } = passkeyDrafts;
            passkeyDrafts = nextDrafts;
            authMessage = '패스키를 삭제했습니다.';
        } finally {
            isWorking = false;
        }
    }

    /**
     * @param {{ message?: string; status?: number; statusText?: string }} error
     */
    function getAuthErrorMessage(error) {
        if (error.status === 503) {
            return '데이터베이스 설정 후 이용할 수 있습니다.';
        }

        const message = error.message || error.statusText || '';
        if (/valid email verification code|required for passkey|INVALID_PASSKEY_EMAIL_CODE/i.test(message)) {
            return '확인 코드가 맞지 않거나 만료되었습니다. 가장 최근에 받은 코드를 입력해 주세요.';
        }
        if (/valid recovery code|INVALID_PASSKEY_RECOVERY_CODE/i.test(message)) {
            return '복구 코드가 맞지 않거나 이미 사용되었습니다.';
        }
        if (/not allowed|EMAIL_NOT_ALLOWED/i.test(message)) {
            return '가입이 허용된 이메일만 사용할 수 있습니다.';
        }
        if (/failed to verify registration/i.test(message)) {
            return '패스키 등록을 확인하지 못했습니다. 새 확인 코드를 받아 다시 시도해 주세요.';
        }
        if (/authentication failed|passkey not found/i.test(message)) {
            return '등록된 패스키를 찾지 못했습니다.';
        }

        return message || '인증 요청을 완료하지 못했습니다.';
    }

    function clearVerificationState() {
        emailVerificationCode = '';
        verificationEmail = '';
        verificationExpiresAt = '';
    }

    function isExpiredVerificationCode() {
        const expiresAt = Date.parse(verificationExpiresAt);
        return Number.isFinite(expiresAt) && expiresAt <= Date.now();
    }

    /**
     * @param {string} id
     * @param {string} value
     */
    function setPasskeyDraft(id, value) {
        passkeyDrafts = { ...passkeyDrafts, [id]: value };
    }

    function createSuggestedPasskeyName() {
        return `${detectDeviceLabel()} 패스키 - ${formatLocalDate(new Date())}`;
    }

    /**
     * @param {import('$lib/client/passkey-management-api.js').ManagedPasskey} passkey
     */
    function createFallbackPasskeyName(passkey) {
        return `패스키 ${passkey.createdAt ? formatShortDate(passkey.createdAt) : passkey.id.slice(0, 6)}`;
    }

    /**
     * @param {import('$lib/client/passkey-management-api.js').ManagedPasskey} passkey
     */
    function formatPasskeyMeta(passkey) {
        const created = passkey.createdAt ? `등록 ${formatShortDate(passkey.createdAt)}` : '등록일 알 수 없음';
        const backup = passkey.backedUp ? '동기화됨' : '이 기기';
        return `${created} · ${backup}`;
    }

    function detectDeviceLabel() {
        if (typeof navigator === 'undefined') {
            return '내 기기';
        }

        const platform = navigator.platform || '';
        const userAgent = navigator.userAgent || '';
        const maxTouchPoints = navigator.maxTouchPoints || 0;

        if (/iPad/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) {
            return 'iPad';
        }
        if (/iPhone/i.test(userAgent)) {
            return 'iPhone';
        }
        if (/Windows|Win32|Win64/i.test(platform) || /Windows/i.test(userAgent)) {
            return 'Windows PC';
        }
        if (/Mac/i.test(platform) || /Macintosh/i.test(userAgent)) {
            return 'Mac';
        }
        if (/Android/i.test(userAgent)) {
            return 'Android';
        }

        return '내 기기';
    }

    /**
     * @param {Date} date
     */
    function formatLocalDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * @param {string} value
     */
    function formatShortDate(value) {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) {
            return '알 수 없음';
        }

        return formatLocalDate(date);
    }
</script>

<div class="auth-panel">
    {#if $session.data?.user}
        <span class="auth-identity">{$session.data.user.email || $session.data.user.name}</span>
        <input class="auth-input auth-input-small" type="text" bind:value={passkeyName} aria-label="패스키 이름" />
        <button class="btn" onclick={registerPasskey} disabled={isWorking}>패스키 추가</button>
        <button class="btn" onclick={togglePasskeyManager} disabled={isWorking}>
            {passkeyManagerOpen ? '관리 닫기' : '패스키 관리'}
        </button>
        <button class="btn" onclick={generateRecoveryCodes} disabled={isWorking}>복구 코드</button>
        <button class="btn" onclick={deleteRecoveryCodes} disabled={isWorking}>복구 폐기</button>
        <label class="auth-cache-option" title="이 기기에 저장된 작업 캐시와 오프라인 대기 변경을 로그아웃 때 삭제합니다.">
            <input type="checkbox" bind:checked={clearLocalDataOnSignOut} />
            캐시 삭제
        </label>
        <button class="btn" onclick={signOut} disabled={isWorking}>로그아웃</button>
    {:else}
        <input class="auth-input" type="email" bind:value={email} placeholder="email@example.com" autocomplete="email" />
        <input class="auth-input auth-input-small" type="text" bind:value={name} placeholder="이름" autocomplete="name" />
        {#if isRecoveryMode}
            <input class="auth-input" type="text" bind:value={recoveryCode} placeholder="복구 코드" autocomplete="one-time-code" />
        {:else}
            <input class="auth-input auth-input-small" type="text" bind:value={emailVerificationCode} placeholder="확인 코드" autocomplete="one-time-code" />
            <button class="btn" onclick={sendVerificationCode} disabled={isWorking}>코드 받기</button>
        {/if}
        <button class="btn btn-primary" onclick={registerPasskey} disabled={isWorking}>패스키 만들기</button>
        <button class="btn" onclick={signInPasskey} disabled={isWorking}>패스키 로그인</button>
        <button class="btn" onclick={() => isRecoveryMode = !isRecoveryMode} disabled={isWorking}>
            {isRecoveryMode ? '가입 모드' : '복구 모드'}
        </button>
    {/if}

    {#if authError}
        <span class="auth-status auth-error" role="alert">{authError}</span>
    {:else if authMessage}
        <span class="auth-status">{authMessage}</span>
    {/if}

    {#if $session.data?.user && recoverySummary}
        <span class="auth-status">복구 코드 {recoverySummary.available}/{recoverySummary.total}</span>
    {/if}

    {#if $session.data?.user && passkeyManagerOpen}
        <div class="passkey-manager" aria-label="등록된 패스키 관리">
            <div class="passkey-manager-header">
                <span>등록된 패스키</span>
                <button class="btn btn-small" onclick={loadPasskeys} disabled={passkeyListLoading || isWorking}>
                    {passkeyListLoading ? '불러오는 중' : '다시 불러오기'}
                </button>
            </div>

            {#if passkeyListError}
                <span class="auth-status auth-error" role="alert">{passkeyListError}</span>
            {:else if passkeyListLoading}
                <span class="auth-status">패스키 목록을 불러오는 중입니다.</span>
            {:else if managedPasskeys.length === 0}
                <span class="auth-status">등록된 패스키가 없습니다.</span>
            {:else}
                <div class="passkey-list">
                    {#each managedPasskeys as passkey (passkey.id)}
                        <div class="passkey-row">
                            <div class="passkey-row-main">
                                <input
                                    class="auth-input passkey-name-input"
                                    type="text"
                                    value={passkeyDrafts[passkey.id] ?? passkey.name ?? createFallbackPasskeyName(passkey)}
                                    aria-label="패스키 이름"
                                    oninput={(event) => setPasskeyDraft(passkey.id, event.currentTarget.value)} />
                                <small>{formatPasskeyMeta(passkey)}</small>
                            </div>
                            <div class="passkey-row-actions">
                                <button class="btn btn-small" onclick={() => saveManagedPasskeyName(passkey)} disabled={isWorking}>
                                    저장
                                </button>
                                <button
                                    class="btn btn-small btn-danger"
                                    onclick={() => removeManagedPasskey(passkey)}
                                    disabled={isWorking || managedPasskeys.length <= 1}
                                    title={managedPasskeys.length <= 1 ? '마지막 패스키는 삭제하지 않는 것이 안전합니다.' : '패스키 삭제'}>
                                    삭제
                                </button>
                            </div>
                        </div>
                    {/each}
                </div>
                <span class="auth-status">Apple 패스키 선택 화면의 기존 이름은 기기 캐시 때문에 그대로 보일 수 있습니다.</span>
            {/if}
        </div>
    {/if}

    {#if $session.data?.user && newRecoveryCodes.length > 0}
        <div class="recovery-code-list" aria-label="새 복구 코드">
            {#each newRecoveryCodes as code}
                <code>{code}</code>
            {/each}
        </div>
    {/if}
</div>
