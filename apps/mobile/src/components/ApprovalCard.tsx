import { Button, Card, T } from '@/components/ui';
import { api, type MyApproval, type Period } from '@/lib/api';
import { confirmAsync, notify } from '@/lib/dialogs';
import { useTheme } from '@/lib/theme';

/**
 * For a schedule out for review: approve your own schedule. Once approved the
 * card goes away for good, unless your shifts change afterwards, when it asks
 * you to check and approve again. Your service's scheduler and the admin see
 * who has approved.
 */
export function ApprovalCard({ period, approval, onChange }: { period: Period; approval?: MyApproval; onChange: () => void }) {
  const t = useTheme();
  const approve = async () => {
    if (!(await confirmAsync('Approve your schedule?', `You’ve checked your call in ${period.label} and it looks right. This can’t be undone.`, 'Approve'))) return;
    try {
      await api('POST', `/api/periods/${period.id}/approvals`, { kind: 'surgeon' });
      onChange();
    } catch (e) {
      notify('Could not approve', (e as Error).message);
    }
  };
  // Approved and still current: nothing to do, so no card. (Approvals can't be withdrawn.)
  if (approval?.current) return null;
  return (
    <Card style={{ gap: 8, borderColor: t.warn }}>
      <T bold>{approval ? 'Your schedule changed since you approved it' : `Please check your ${period.label} schedule`}</T>
      <T muted size={13}>
        {approval
          ? 'Something in your call moved after you approved it. Check your shifts again, then approve.'
          : 'This is the proposed schedule. Tap any shift that looks wrong to flag it. When your call looks right, approve it so the scheduler knows.'}
      </T>
      <Button label={approval ? 'Approve again' : 'Approve my schedule'} onPress={approve} />
    </Card>
  );
}
