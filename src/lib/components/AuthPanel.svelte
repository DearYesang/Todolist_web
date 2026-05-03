<script>
    import { authClient } from '$lib/client/auth-client.js';

    const session = authClient.useSession();

    let email = $state('');
    let name = $state('');
    let passkeyName = $state('내 기기');
    let isWorking = $state(false);
    let authMessage = $state('');
    let authError = $state('');

    async function registerPasskey() {
        if (isWorking) return;

        const normalizedEmail = email.trim().toLowerCase();
        if (!$session.data?.user && !normalizedEmail) {
            authError = '이메일을 입력해 주세요.';
            return;
        }

        authMessage = '';
        authError = '';
        isWorking = true;

        try {
            const result = await authClient.passkey.addPasskey({
                name: passkeyName.trim() || '내 기기',
                authenticatorAttachment: 'platform',
                context: $session.data?.user
                    ? null
                    : JSON.stringify({
                        email: normalizedEmail,
                        name: name.trim() || normalizedEmail
                    })
            });

            if (result.error) {
                authError = getAuthErrorMessage(result.error);
                return;
            }

			authMessage = '패스키가 등록되었습니다.';
			if (!$session.data?.user) {
				isWorking = false;
				await signInPasskey();
			} else {
				await $session.refetch();
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
        isWorking = true;

        try {
            const result = await authClient.signOut();
            if (result.error) {
                authError = getAuthErrorMessage(result.error);
                return;
            }

            authMessage = '로그아웃되었습니다.';
            await $session.refetch();
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

        return error.message || error.statusText || '인증 요청을 완료하지 못했습니다.';
    }
</script>

<div class="auth-panel">
    {#if $session.data?.user}
        <span class="auth-identity">{$session.data.user.email || $session.data.user.name}</span>
        <input class="auth-input auth-input-small" type="text" bind:value={passkeyName} aria-label="패스키 이름" />
        <button class="btn" onclick={registerPasskey} disabled={isWorking}>패스키 추가</button>
        <button class="btn" onclick={signOut} disabled={isWorking}>로그아웃</button>
    {:else}
        <input class="auth-input" type="email" bind:value={email} placeholder="email@example.com" autocomplete="email" />
        <input class="auth-input auth-input-small" type="text" bind:value={name} placeholder="이름" autocomplete="name" />
        <button class="btn btn-primary" onclick={registerPasskey} disabled={isWorking}>패스키 만들기</button>
        <button class="btn" onclick={signInPasskey} disabled={isWorking}>패스키 로그인</button>
    {/if}

    {#if authError}
        <span class="auth-status auth-error" role="alert">{authError}</span>
    {:else if authMessage}
        <span class="auth-status">{authMessage}</span>
    {/if}
</div>
