import { Pressable, View } from 'react-native';
import { Button, Card, T } from '@/components/ui';
import { api, type MyApproval, type Period } from '@/lib/api';
import { confirmAsync, notify } from '@/lib/dialogs';
import { useTheme } from '@/lib/theme';

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

/**
 * For a schedule out for review: approve your own schedule, or see that you
 * did (and whether it changed since). Your service's scheduler and the
 * admin see who has approved.
 */
export function ApprovalCard({ period, approval, onChange }: { period: Period; approval?: MyApproval; onChange: () => void }) {
  const t = useTheme();
  const approve = async () => {
    if (!(await confirmAsync('Approve your schedule?', `You’ve checked your call in ${period.label} and it looks right.`, 'Approve'))) return;
    try {
      await api('POST', `/api/periods/${period.id}/approvals`, { kind: 'surgeon' });
      onChange();
    } catch (e) {
      notify('Could not approve', (e as Error).message);
    }
  };
  const withdraw = async () => {
    try {
      await api('POST', `/api/periods/${period.id}/approvals/withdraw`, { kind: 'surgeon' });
      onChange();
    } catch (e) {
      notify('Could not withdraw', (e as Error).message);
    }
  };

  if (approval?.current) {
    return (
      <Card style={{ gap: 4, borderColor: t.ok }}>
        <T bold style={{ color: t.ok }}>✓ You approved your {period.label} schedule</T>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T muted size={13}>On {shortDate(approval.at)}. Flag anything that changes.</T>
          <Pressable onPress={withdraw} hitSlop={8}>
            <T size={13} style={{ color: t.bad }}>Withdraw</T>
          </Pressable>
        </View>
      </Card>
    );
  }
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
