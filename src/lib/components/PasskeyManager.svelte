<script>
    import { deleteUserPasskey, listUserPasskeys, updateUserPasskeyName } from '$lib/client/passkey-management-api.js';
    import { createFallbackPasskeyName, formatPasskeyMeta, getAuthErrorMessage } from '$lib/client/auth-labels.js';

    // The registered-passkey list under the account controls. It stays
    // mounted while signed in and only hides when closed; the account
    // controls call loadPasskeys() when it opens and after a passkey is
    // added. It shares their busy flag and status line through the bound
    // props.
    /** @type {{
     *   open: boolean;
     *   isWorking: boolean;
     *   authMessage: string;
     *   authError: string;
     * }} */
    let { open, isWorking = $bindable(), authMessage = $bindable(), authError = $bindable() } = $props();

    let passkeyListLoading = $state(false);
    let passkeyListError = $state('');
    let passkeyDrafts = $state(/** @type {Record<string, string>} */ ({}));
    let managedPasskeys = $state(/** @type {import('$lib/client/passkey-management-api.js').ManagedPasskey[]} */ ([]));

    export async function loadPasskeys() {
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

            managedPasskeys = managedPasskeys.map((item) => (item.id === passkey.id ? result.passkey : item));
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
     * @param {string} id
     * @param {string} value
     */
    function setPasskeyDraft(id, value) {
        passkeyDrafts = { ...passkeyDrafts, [id]: value };
    }
</script>

{#if open}
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
                            <button
                                class="btn btn-small"
                                onclick={() => saveManagedPasskeyName(passkey)}
                                disabled={isWorking}>
                                저장
                            </button>
                            <button
                                class="btn btn-small btn-danger"
                                onclick={() => removeManagedPasskey(passkey)}
                                disabled={isWorking || managedPasskeys.length <= 1}
                                title={managedPasskeys.length <= 1
                                    ? '마지막 패스키는 삭제하지 않는 것이 안전합니다.'
                                    : '패스키 삭제'}>
                                삭제
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
            <span class="auth-status"
                >Apple 패스키 선택 화면의 기존 이름은 기기 캐시 때문에 그대로 보일 수 있습니다.</span>
        {/if}
    </div>
{/if}
