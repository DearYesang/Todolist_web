<script>
    import { authClient } from '$lib/client/auth-client.js';
    import AuthAccountControls from './AuthAccountControls.svelte';
    import AuthSignInControls from './AuthSignInControls.svelte';

    const session = authClient.useSession();
</script>

<div class="auth-panel">
    {#if $session.data?.user}
        <AuthAccountControls />
    {:else}
        <AuthSignInControls />
    {/if}
</div>
