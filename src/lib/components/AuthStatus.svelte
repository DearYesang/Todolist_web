<script>
    /** @type {{ error: string; message: string }} */
    let { error, message } = $props();
</script>

{#if error}
    <span class="auth-status auth-error" role="alert">{error}</span>
{:else if message}
    <span class="auth-status">{message}</span>
{/if}
