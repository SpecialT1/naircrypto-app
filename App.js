import React, { useState, useEffect } from 'react';
import { NavigationContainer, createStackNavigator } from '@react-navigation/native';
import {
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  StyleSheet,
  Alert,
} from 'react-native';
import axios from 'axios';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ExpoCrypto from 'expo-crypto';
import { Connection, Keypair, Transaction, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';

// Live Connections
const solanaConnection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
const RATE_API = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'; // Live fallback

// Wallet Generation
const generateWallet = async () => {
  try {
    const solKeypair = Keypair.generate();
    const solSecretHex = Buffer.from(solKeypair.secretKey).toString('hex');
    const solEncrypted = await ExpoCrypto.encryptAsync(ExpoCrypto.CryptoEncoding.HEX, solSecretHex, { key: 'naircrypto-live' });
    return { solana: { publicKey: solKeypair.publicKey.toString(), encryptedSecret: solEncrypted } };
  } catch (error) {
    Alert.alert('Error', 'Wallet creation failed. Please try again.');
    return null;
  }
};

// Send SOL Transaction
const sendSol = async (encryptedSecret, toPublicKey, amount) => {
  try {
    const secretHex = await ExpoCrypto.decryptAsync(ExpoCrypto.CryptoEncoding.HEX, encryptedSecret, { key: 'naircrypto-live' });
    const fromKeypair = Keypair.fromSecretKey(Buffer.from(secretHex, 'hex'));
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: new PublicKey(toPublicKey),
        lamports: amount * LAMPORTS_PER_SOL,
      })
    );
    const signature = await solanaConnection.sendTransaction(transaction, [fromKeypair], { skipPreflight: true });
    await solanaConnection.confirmTransaction(signature, 'confirmed');
    return signature;
  } catch (error) {
    Alert.alert('Error', 'Couldn’t send SOL. Check address or network.');
    throw error;
  }
};

// Biometric Auth
const authenticate = async () => {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      Alert.alert('Error', 'Biometric not supported.');
      return false;
    }
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock NairCrypto' });
    return result.success;
  } catch (error) {
    Alert.alert('Error', 'Biometric check failed.');
    return false;
  }
};

// Screens
const Stack = createStackNavigator();

const DashboardScreen = React.memo(({ navigation }) => {
  const [naira, setNaira] = useState('');
  const [sol, setSol] = useState(0);
  const [rate, setRate] = useState(0);

  useEffect(() => {
    let mounted = true;
    const updateRate = async () => {
      try {
        const res = await axios.get(RATE_API, { timeout: 3000 });
        if (mounted) setRate(res.data.solana.usd * 1500); // 1 USD = 1500 NGN
      } catch (error) {
        if (mounted) setRate(0);
      }
    };
    updateRate();
    const interval = setInterval(updateRate, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const convert = () => setSol(naira / rate || 0);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>NairCrypto</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter Naira (NGN)"
        value={naira}
        onChangeText={setNaira}
        keyboardType="numeric"
      />
      <Text style={styles.text}>{sol.toFixed(4)} SOL</Text>
      <Button title="Convert" onPress={convert} color="#00C896" />
      <Button title="Go to Wallet" onPress={() => navigation.navigate('Wallet')} />
    </View>
  );
});

const WalletScreen = React.memo(() => {
  const [wallet, setWallet] = useState(null);
  const [balance, setBalance] = useState('0.0');
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (!wallet) {
      generateWallet().then(setWallet);
    } else {
      solanaConnection.getBalance(new PublicKey(wallet.solana.publicKey))
        .then(bal => setBalance((bal / LAMPORTS_PER_SOL).toFixed(4)))
        .catch(() => setBalance('0.0'));
    }
  }, [wallet]);

  const handleSend = async () => {
    if (!wallet || !toAddress || !amount) {
      Alert.alert('Error', 'Fill all fields.');
      return;
    }
    if (!(await authenticate())) {
      Alert.alert('Error', 'Authentication failed.');
      return;
    }
    try {
      const signature = await sendSol(wallet.solana.encryptedSecret, toAddress, parseFloat(amount));
      Alert.alert('Success', `Sent! Tx: ${signature.slice(0, 10)}...`);
      setBalance(await solanaConnection.getBalance(new PublicKey(wallet.solana.publicKey)) / LAMPORTS_PER_SOL);
    } catch (error) {}
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Wallet</Text>
      {wallet && (
        <>
          <Text style={styles.text}>SOL Address: {wallet.solana.publicKey.slice(0, 8)}...</Text>
          <Text style={styles.text}>Balance: {balance} SOL</Text>
        </>
      )}
      <TextInput style={styles.input} placeholder="Recipient Address" value={toAddress} onChangeText={setToAddress} />
      <TextInput style={styles.input} placeholder="Amount (SOL)" value={amount} onChangeText={setAmount} keyboardType="numeric" />
      <Button title="Send SOL" onPress={handleSend} color="#00C896" />
    </View>
  );
});

// Main App
export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Dashboard">
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="Wallet" component={WalletScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 10, backgroundColor: '#1A1A1A' },
  title: { color: '#FFF', fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#00C896', padding: 8, marginVertical: 5, color: '#FFF', borderRadius: 4 },
  text: { color: '#FFF', fontSize: 14, marginVertical: 3 },
});
