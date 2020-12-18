import { Module } from 'vuex'
import { RootState } from '@/store/types'
import { NetworkState } from '@/store/modules/network/types'

import { ava, avm, bintools, cChain, infoApi, pChain } from '@/AVA'
import { AvaNetwork } from '@/js/AvaNetwork'
import { explorer_api } from '@/explorer_api'
import BN from 'bn.js'
import { getPreferredHRP } from 'avalanche/dist/utils'
import router from '@/router'
import { web3 } from '@/evm'

const network_module: Module<NetworkState, RootState> = {
    namespaced: true,
    state: {
        status: 'disconnected', // disconnected | connecting | connected
        networks: [],
        networksCustom: [],
        selectedNetwork: null,
        txFee: new BN(0),
    },
    mutations: {
        addNetwork(state, net: AvaNetwork) {
            state.networks.push(net)
        },
    },
    getters: {
        allNetworks(state) {
            return state.networks.concat(state.networksCustom)
        },
    },
    actions: {
        addCustomNetwork({ state, dispatch }, net: AvaNetwork) {
            state.networksCustom.push(net)
            dispatch('save')
        },

        async removeCustomNetwork({ state, dispatch }, net: AvaNetwork) {
            let index = state.networksCustom.indexOf(net)
            state.networksCustom.splice(index, 1)
            await dispatch('save')
        },
        saveSelectedNetwork({ state }) {
            let data = JSON.stringify(state.selectedNetwork)
            localStorage.setItem('network_selected', data)
        },
        async loadSelectedNetwork({ dispatch, getters }): Promise<boolean> {
            let data = localStorage.getItem('network_selected')
            if (!data) return false
            try {
                // let net: AvaNetwork = JSON.parse(data);
                let nets: AvaNetwork[] = getters.allNetworks

                for (var i = 0; i < nets.length; i++) {
                    let net = nets[i]
                    if (JSON.stringify(net) === data) {
                        dispatch('setNetwork', net)
                        return true
                    }
                }
                return false
            } catch (e) {
                return false
            }
        },

        // Save custom networks to local storage
        save({ state }) {
            let data = JSON.stringify(state.networksCustom)
            localStorage.setItem('networks', data)
        },
        // Load custom networks from local storage
        load({ dispatch }) {
            let data = localStorage.getItem('networks')

            if (data) {
                let networks: AvaNetwork[] = JSON.parse(data)

                networks.forEach((n) => {
                    let newCustom = new AvaNetwork(
                        n.name,
                        n.url,
                        n.networkId,
                        n.explorerUrl,
                        n.explorerSiteUrl,
                        n.readonly
                    )
                    dispatch('addCustomNetwork', newCustom)
                })
            }
        },
        async setNetwork(
            { state, dispatch, commit, rootState },
            net: AvaNetwork
        ) {
            state.status = 'connecting'
            ava.setAddress(net.ip, net.port, net.protocol)
            ava.setNetworkID(net.networkId)

            // Reset transaction history
            commit('History/clear', null, { root: true })

            // Query the network to get network id
            let chainIdX = await infoApi.getBlockchainID('X')
            let chainIdP = await infoApi.getBlockchainID('P')
            let chainIdC = await infoApi.getBlockchainID('C')

            avm.refreshBlockchainID(chainIdX)
            avm.setBlockchainAlias('X')
            pChain.refreshBlockchainID(chainIdP)
            pChain.setBlockchainAlias('P')
            cChain.refreshBlockchainID(chainIdC)
            cChain.setBlockchainAlias('C')

            avm.getAVAXAssetID(true)
            pChain.getAVAXAssetID(true)
            cChain.getAVAXAssetID(true)

            state.selectedNetwork = net
            dispatch('saveSelectedNetwork')

            // Update explorer api
            explorer_api.defaults.baseURL = net.explorerUrl

            // Set web3 Network Settings
            let web3Provider = `https://${net.ip}:${net.port}/ext/bc/C/rpc`
            web3.setProvider(web3Provider)

            commit('Assets/removeAllAssets', null, { root: true })
            await dispatch('Assets/updateAvaAsset', null, { root: true })

            // If authenticated
            if (rootState.isAuth) {
                // Go back to wallet page
                router.replace('/wallet')
                for (var i = 0; i < rootState.wallets.length; i++) {
                    let w = rootState.wallets[i]
                    w.onnetworkchange()
                }
            }

            setTimeout(() => {
                dispatch('Assets/updateUTXOs', null, { root: true })
                dispatch('Platform/update', null, { root: true })
                dispatch('Platform/updateMinStakeAmount', null, { root: true })
                dispatch('updateTxFee')
            }, 2000)

            // state.isConnected = true;
            state.status = 'connected'
            return true
        },

        async updateTxFee({ state }) {
            let txFee = await infoApi.getTxFee()
            state.txFee = txFee.txFee
            avm.setTxFee(txFee.txFee)
        },

        async init({ state, commit, dispatch }) {
            // let netTest = new AvaNetwork("Everest TestNet", 'https://api.avax-test.network:443', 4, 'https://explorerapi.avax.network');
            let manhattan = new AvaNetwork(
                'Mainnet',
                'https://api.avax.network:443',
                1,
                'https://explorerapi.avax.network',
                'https://explorer.avax.network',
                true
            )
            let fuji = new AvaNetwork(
                'Fuji',
                'https://api.avax-test.network:443',
                5,
                'https://explorerapi.avax-test.network',
                'https://explorer.avax-test.network',
                true
            )

            // Load custom networks if any
            try {
                await dispatch('load')
            } catch (e) {
                console.error(e)
            }

            // commit('addNetwork', netTest);
            commit('addNetwork', manhattan)
            commit('addNetwork', fuji)

            try {
                let isSet = await dispatch('loadSelectedNetwork')
                if (!isSet) {
                    await dispatch('setNetwork', state.networks[0])
                }
                return true
            } catch (e) {
                console.log(e)
                state.status = 'disconnected'
            }
        },
    },
}

export default network_module
