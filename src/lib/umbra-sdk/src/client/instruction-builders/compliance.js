import { program } from '@/idl';
import { convertArciumX25519NonceToTransactionInput, convertSha3HashToTransactionInput, } from '@/types';
import { getUserAllotedComplianceGrantPda } from '@/utils/pda-generators';
export async function buildInitComplianceGrantInstruction(txAccounts, txArgs) {
    const ixBuilder = program.methods
        .initComplianceGrant(convertArciumX25519NonceToTransactionInput(txArgs.nonce), convertSha3HashToTransactionInput(txArgs.optionalData))
        .accountsPartial({
        sender: txAccounts.sender,
        arciumSenderUserAccount: txAccounts.sender,
        destinationArciumUserAccount: txAccounts.destinationAddress,
    });
    return await ixBuilder.instruction();
}
export async function buildDeleteComplianceGrantInstruction(txAccounts, txArgs) {
    const userAllotedComplianceGrantPda = getUserAllotedComplianceGrantPda(txAccounts.senderSigner, txAccounts.destinationAddress, txArgs.nonce);
    const ixBuilder = program.methods
        .deleteComplianceGrant(convertArciumX25519NonceToTransactionInput(txArgs.nonce), convertSha3HashToTransactionInput(txArgs.optionalData))
        .accountsPartial({
        senderSigner: txAccounts.senderSigner,
        complianceGrant: userAllotedComplianceGrantPda,
    });
    return await ixBuilder.instruction();
}
