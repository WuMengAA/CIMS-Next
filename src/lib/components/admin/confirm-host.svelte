<script lang="ts">
	import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
	import { confirmState, settleConfirm } from "./confirm.svelte";
</script>

<AlertDialog.Root open={confirmState.open} onOpenChange={(o) => { if (!o) settleConfirm(false); }}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{confirmState.title}</AlertDialog.Title>
			<AlertDialog.Description>{confirmState.description}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>取消</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={() => settleConfirm(true)}>确认删除</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
