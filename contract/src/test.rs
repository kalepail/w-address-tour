//! Tests for the wallet and for CAP-84 behavior in the Soroban host.

extern crate std;
use super::*;
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use soroban_sdk::{
    testutils::{Address as _, Events as _, MuxedAddress as _},
    token::{StellarAssetClient, TokenClient},
    vec, Address, IntoVal, Map, MuxedAddress, Symbol, TryFromVal, Val,
};

fn setup() -> (Env, Address, SigningKey) {
    let env = Env::default();
    let key = SigningKey::generate(&mut OsRng);
    let owner = BytesN::from_array(&env, &key.verifying_key().to_bytes());
    let wallet = env.register(MuxedWallet, (owner,));
    (env, wallet, key)
}

fn token(env: &Env) -> (Address, Address) {
    let issuer = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(issuer.clone());
    (sac.address(), issuer)
}

#[test]
fn stores_owner() {
    let (env, wallet, key) = setup();
    let client = MuxedWalletClient::new(&env, &wallet);
    assert_eq!(client.owner().to_array(), key.verifying_key().to_bytes());
}

#[test]
fn w_address_round_trips_to_the_same_contract() {
    let (_env, wallet, _) = setup();
    let muxed = MuxedAddress::new(wallet.clone(), 42);
    assert_eq!(muxed.address(), wallet);
    assert_eq!(muxed.id(), Some(42));
    let strkey = muxed.to_strkey();
    assert_eq!(strkey.len(), 69);
    let mut buf = [0u8; 69];
    strkey.copy_into_slice(&mut buf);
    assert_eq!(buf[0], b'W');
    // The W strkey parses back to the same contract and id.
    let back = MuxedAddress::from_string(&strkey);
    assert_eq!(back.address(), wallet);
    assert_eq!(back.id(), Some(42));
}

#[test]
fn sac_transfer_to_w_credits_contract_and_emits_to_muxed_id() {
    let (env, wallet, _) = setup();
    env.mock_all_auths();
    let (sac, _issuer) = token(&env);
    let sender = Address::generate(&env);
    StellarAssetClient::new(&env, &sac).mint(&sender, &1_000);

    let tok = TokenClient::new(&env, &sac);
    let w = MuxedAddress::new(wallet.clone(), 7);
    tok.transfer(&sender, &w, &250);

    // The event names the plain C address and carries the muxed id.
    let events = env.events().all();
    let (_, topics, data) = events.events().iter().last().cloned().map(|e| {
        let v = e.body;
        let soroban_sdk::xdr::ContractEventBody::V0(b) = v;
        (e.contract_id, b.topics, b.data)
    }).unwrap();
    assert_eq!(topics.len(), 4); // transfer, from, to, asset
    let to: Address = Address::try_from_val(&env, &Val::try_from_val(&env, &topics[2]).unwrap()).unwrap();
    assert_eq!(to, wallet);
    let map: Map<Symbol, Val> = Map::try_from_val(&env, &Val::try_from_val(&env, &data).unwrap()).unwrap();
    let id: u64 = map.get(Symbol::new(&env, "to_muxed_id")).unwrap().into_val(&env);
    assert_eq!(id, 7);
    let amount: i128 = map.get(Symbol::new(&env, "amount")).unwrap().into_val(&env);
    assert_eq!(amount, 250);

    // On chain, a W address is just the wallet. One balance.
    // (Read it last: each call resets the recorded events.)
    assert_eq!(tok.balance(&wallet), 250);
}

#[test]
#[should_panic]
fn w_address_is_refused_where_a_plain_address_is_expected() {
    let (env, wallet, _) = setup();
    let (sac, _) = token(&env);
    let w = MuxedAddress::new(wallet, 7);
    // `balance` takes an `Address`. A muxed address is a different host type.
    let _: i128 = env.invoke_contract(&sac, &Symbol::new(&env, "balance"), vec![&env, w.to_val()]);
}

#[test]
fn many_w_addresses_share_one_balance() {
    let (env, wallet, _) = setup();
    env.mock_all_auths();
    let (sac, _) = token(&env);
    let sender = Address::generate(&env);
    StellarAssetClient::new(&env, &sac).mint(&sender, &1_000);
    let tok = TokenClient::new(&env, &sac);
    for (id, amt) in [(1u64, 100i128), (2, 200), (u64::MAX, 300)] {
        tok.transfer(&sender, &MuxedAddress::new(wallet.clone(), id), &amt);
    }
    assert_eq!(tok.balance(&wallet), 600);
}

#[test]
fn owner_signature_authorizes() {
    let (env, wallet, key) = setup();
    let payload = BytesN::from_array(&env, &[9u8; 32]);
    let sig = BytesN::from_array(&env, &key.sign(&payload.to_array()).to_bytes());
    env.try_invoke_contract_check_auth::<Error>(&wallet, &payload, sig.into_val(&env), &vec![&env])
        .expect("owner signature must pass");
}

#[test]
fn wrong_signature_is_rejected() {
    let (env, wallet, _) = setup();
    let other = SigningKey::generate(&mut OsRng);
    let payload = BytesN::from_array(&env, &[9u8; 32]);
    let sig = BytesN::from_array(&env, &other.sign(&payload.to_array()).to_bytes());
    assert!(env
        .try_invoke_contract_check_auth::<Error>(&wallet, &payload, sig.into_val(&env), &vec![&env])
        .is_err());
}
