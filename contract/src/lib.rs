//! A minimal smart wallet for Stellar, used to show CAP-84 muxed contract
//! addresses (`W...`) in Protocol 30.
//!
//! The wallet is one contract with one `C...` address. It holds one Ed25519
//! owner key and approves any action the owner signs. The wallet does not need
//! any code for `W...` addresses: the Stellar Asset Contract credits the plain
//! `C...` balance and puts the 64-bit muxed id in its `transfer` event as
//! `to_muxed_id`. Apps read the events and sort deposits into sub-accounts.
//!
//! This is a teaching example. It has no spending limits, no recovery path,
//! and no upgrade function.

#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    BytesN, Env, Vec,
};

#[cfg(test)]
mod test;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Owner,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The wallet has no owner. The constructor always sets one.
    MissingOwner = 1,
}

#[contract]
pub struct MuxedWallet;

#[contractimpl]
impl MuxedWallet {
    /// Runs once, at deployment. Stores the owner's Ed25519 public key.
    pub fn __constructor(env: Env, owner: BytesN<32>) {
        env.storage().instance().set(&DataKey::Owner, &owner);
    }

    /// Returns the owner's Ed25519 public key.
    pub fn owner(env: Env) -> Result<BytesN<32>, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(Error::MissingOwner)
    }
}

#[contractimpl]
impl CustomAccountInterface for MuxedWallet {
    type Signature = BytesN<64>;
    type Error = Error;

    /// The network calls this when something needs the wallet's approval.
    /// `ed25519_verify` traps on a bad signature, which aborts the transaction.
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: BytesN<64>,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let owner: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(Error::MissingOwner)?;
        env.crypto()
            .ed25519_verify(&owner, &signature_payload.to_bytes().into(), &signature);
        Ok(())
    }
}
