<script>
    import { onMount } from 'svelte';
    import { authClient } from '$lib/client/auth-client.js';
    import { requestEmailVerificationCode } from '$lib/client/account-security-api.js';
    import { createPasskeySignupContext, getPasskeySignupError } from '$lib/client/passkey-signup.js';
    import { createSuggestedPasskeyName, getAuthErrorMessage } from '$lib/client/auth-labels.js';
    import AuthStatus from './AuthStatus.svelte';

    // Signed out: sign up with an email code (or a recovery code) and a new
    // passkey, or sign in with an existing passkey.
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

    onMount(() => {
        passkeyName = createSuggestedPasskeyName();
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

        /** @type {import('$lib/client/passkey-signup.js').PasskeySignupInput} */
        const signupInput = {
            email: email.trim().toLowerCase(),
            name,
            isRecoveryMode,
            emailVerificationCode,
            verificationEmail,
            verificationExpiresAt,
            recoveryCode
        };
        const inputError = getPasskeySignupError(signupInput);
        if (inputError) {
            authError = inputError;
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
                context: createPasskeySignupContext(signupInput)
            });

            if (result.error) {
                authError = getAuthErrorMessage(result.error);
                return;
            }

            authMessage = '패스키가 등록되었습니다.';
            passkeyName = createSuggestedPasskeyName();
            // If a session already exists by now, refresh it instead of
            // asking for the passkey again.
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
</script>

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

<AuthStatus error={authError} message={authMessage} />
