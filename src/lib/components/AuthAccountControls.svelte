<script>
    import { onMount } from 'svelte';
    import { authClient } from '$lib/client/auth-client.js';
    import { createRecoveryCodes, revokeRecoveryCodes } from '$lib/client/account-security-api.js';
    import { clearPendingDefaultView, settlePendingTaskSyncs } from '$lib/client/task-store.js';
    import { clearUserLocalData, countPendingLocalChanges } from '$lib/client/user-scope.js';
    import { createSuggestedPasskeyName, getAuthErrorMessage } from '$lib/client/auth-labels.js';
    import AuthStatus from './AuthStatus.svelte';
    import PasskeyManager from './PasskeyManager.svelte';

    // Signed in: add a passkey, manage passkeys and recovery codes, sign out.
    // AuthPanel mounts this only while there is a session user, so a new
    // sign-in always starts from the initial state below.
    const session = authClient.useSession();

    let passkeyName = $state(createSuggestedPasskeyName());
    let isWorking = $state(false);
    let authMessage = $state('');
    let authError = $state('');
    let recoverySummary = $state(/** @type {import('$lib/client/account-security-api.js').RecoveryCodeSummary | null} */ (null));
    let newRecoveryCodes = $state(/** @type {string[]} */ ([]));
    let passkeyManagerOpen = $state(false);
    /** @type {{ loadPasskeys: () => Promise<void> } | undefined} */
    let passkeyManager = $state();
    let clearLocalDataOnSignOut = $state(true);

    onMount(() => {
        passkeyName = createSuggestedPasskeyName();
    });

    async function registerPasskey() {
        if (isWorking) return;

        authMessage = '';
        authError = '';
        isWorking = true;

        try {
            const selectedPasskeyName = passkeyName.trim() || createSuggestedPasskeyName();
            const result = await authClient.passkey.addPasskey({
                name: selectedPasskeyName,
                authenticatorAttachment: 'platform',
                context: null
            });

            if (result.error) {
                authError = getAuthErrorMessage(result.error);
                return;
            }

            authMessage = '패스키가 등록되었습니다.';
            passkeyName = createSuggestedPasskeyName();
            await $session.refetch();
            if (passkeyManagerOpen) {
                await passkeyManager?.loadPasskeys();
            }
        } finally {
            isWorking = false;
        }
    }

    async function signOut() {
        if (isWorking) return;

        authMessage = '';
        authError = '';
        isWorking = true;

        try {
            // Task edits still on their way to the server go out while the
            // session is valid: sent after it ends, they would fail and be
            // queued under no user. Waits at most 5 seconds. It runs before
            // the "clear local data" question, so the count includes the
            // edits it leaves in the queue: those that failed in a way worth
            // retrying (offline, 401, 409, 429, 503) and, on a timeout, those
            // not yet sent.
            await settlePendingTaskSyncs({ timeoutMs: 5000 });
            if (clearLocalDataOnSignOut && !confirmLocalDataClear()) {
                authMessage = '로그아웃을 취소했습니다. 먼저 Sync로 오프라인 변경을 동기화해 주세요.';
                return;
            }
            const result = await authClient.signOut();
            if (result.error) {
                authError = getAuthErrorMessage(result.error);
                return;
            }

            authMessage = '로그아웃되었습니다.';
            // A default view not yet sent goes even when the cache stays:
            // the next account to sign in here would send it as its own.
            // Handing the board to no user keeps it, because a failed
            // session check does that too.
            clearPendingDefaultView();
            if (clearLocalDataOnSignOut) {
                clearUserLocalData();
                authMessage = '로그아웃했고 이 기기의 오프라인 캐시를 삭제했습니다.';
            }
            recoverySummary = null;
            newRecoveryCodes = [];
            await $session.refetch();
        } finally {
            isWorking = false;
        }
    }

    function confirmLocalDataClear() {
        const pendingChanges = countPendingLocalChanges();
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
            await passkeyManager?.loadPasskeys();
        }
    }
</script>

<span class="auth-identity">{$session.data?.user?.email || $session.data?.user?.name}</span>
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

<AuthStatus error={authError} message={authMessage} />

{#if recoverySummary}
    <span class="auth-status">복구 코드 {recoverySummary.available}/{recoverySummary.total}</span>
{/if}

<PasskeyManager
    bind:this={passkeyManager}
    open={passkeyManagerOpen}
    bind:isWorking
    bind:authMessage
    bind:authError />

{#if newRecoveryCodes.length > 0}
    <div class="recovery-code-list" aria-label="새 복구 코드">
        {#each newRecoveryCodes as code}
            <code>{code}</code>
        {/each}
    </div>
{/if}
