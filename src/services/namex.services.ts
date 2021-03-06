import Axios, { AxiosError } from 'axios'
import { ACCEPTED, CREATED, NO_CONTENT, OK } from 'http-status-codes'

import errorModule from '@/modules/error'
import { ErrorI } from '@/modules/error/store/actions'
import {
  AdvancedSearchI,
  AdvancedSearchResultsI,
  AnalysisJSONI,
  NameRequestI,
  NewRequestNameSearchI,
  StatsI
} from '@/interfaces'
import { RequestActions } from '@/list-data'
import { NrAction, NrState, RollbackActions } from '@/enums'
import { NameRequestPayment } from '@/modules/payment/models'

const ANALYSIS_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes
const axiosNamex = Axios.create()
// Set the request headers for all NameX API requests: nr-number, phone, email
// nr-number, phone, email sessionStorage items are set in mutations
axiosNamex.interceptors.request.use(
  config => {
    config.headers.common['BCREG-NR'] = sessionStorage.getItem('BCREG-nrNum')
    config.headers.common['BCREG-NRL'] = sessionStorage.getItem('BCREG-NRL')
    config.headers.common['BCREG-User-Phone'] = sessionStorage.getItem('BCREG-phoneNumber')
    config.headers.common['BCREG-User-Email'] = sessionStorage.getItem('BCREG-emailAddress')
    console.log('in interceptor, headers: ', config?.headers?.common) // eslint-disable-line
    return config
  },
  error => {
    // console.log('axios interceptor set request headers error: ' + error)
    Promise.reject(error)
  }
)

export default class NamexServices {
  static axios = axiosNamex
  static namexUrl () {
    return sessionStorage.getItem('BASE_URL')
  }
  static async addRequestActionComment (requestAction: NrAction, data: NameRequestI): Promise<NameRequestI> {
    try {
      // const requestAction = getters.getRequestActionOriginal || getters.getRequestActionCd
      const action = RequestActions.find(request => request.value === requestAction)
      const { shortDesc } = action || { shortDesc: 'action not found' }
      const msg = `*** ${shortDesc} ***`

      if (!data['additionalInfo']) {
        // if data.additionalInfo is empty, just assign it to message
        data['additionalInfo'] = msg
        return data
      }

      if (data['additionalInfo'].includes(msg)) {
        // if message is already part of additionalInfo, do nothing, return
        return data
      }

      // by here we know there is some text in additionalInfo
      // but it does not contain the exact msg we must add
      // so we check if there is a previous request_action message
      // which no longer matches msg because we are editing
      let allShortDesc = RequestActions.map(request => `*** ${request.shortDesc} ***`)
      if (allShortDesc.some(desc => data['additionalInfo'].includes(desc))) {
        let desc = allShortDesc.find(sd => data['additionalInfo'].includes(sd))
        data['additionalInfo'] = data['additionalInfo'].replace(desc, msg)
        return data
      }

      // if there is no previous request_action message then
      // we just preserve whatever text there is and append msg
      data['additionalInfo'] += ` \n\n ${msg}`
      return data
    } catch (err) {
      const msg = await this.handleApiError(err, 'Could not add request action comment')
      console.error('addRequestActionComment() =', msg) // eslint-disable-line no-console
      await errorModule.setAppError({ id: 'add-request-action-error', error: msg } as ErrorI)
      return null
    }
  }
  static async cancelPayment (nrId: number, paymentId: string): Promise<NameRequestPayment> {
    const paymentResponse: NameRequestPayment = {
      paymentSuccess: false
    }

    try {
      console.log('delete ', sessionStorage.getItem('BCREG-nrNum'), sessionStorage.getItem('BCREG-NRL'), sessionStorage.getItem('BCREG-phoneNumber'), sessionStorage.getItem('BCREG-emailAddress')) // eslint-disable-line
      const response = await this.axios.delete(`${this.namexUrl()}/payments/${nrId}/payment/${paymentId}`, {
        headers: { 'Content-Type': 'application/json' }
      })

      if (response?.status === OK) {
        paymentResponse.payment = response.data
        paymentResponse.httpStatusCode = response.status.toString()
        paymentResponse.paymentSuccess = true
      } else {
        // eslint-disable-next-line no-console
        console.error('cancelPayment(), status was not 200, response =', response)
        paymentResponse.httpStatusCode = response.status.toString()
        paymentResponse.paymentSuccess = false
      }

      return paymentResponse
    } catch (err) {
      const msg = await this.handleApiError(err, 'Could not cancel payment')
      console.error('cancelPayment() =', msg) // eslint-disable-line no-console
      await errorModule.setAppError({ id: 'cancel-payment-error', error: msg } as ErrorI)
      return null
    }
  }
  static async checkinNameRequest (nrId: number, nrState: NrState): Promise<boolean> {
    try {
      // Approved or Rejected Name Requests are not checked out due to limited data that is editable.
      // Return out of checkIn because the NR was never checked out.
      if (nrState === NrState.APPROVED || nrState === NrState.REJECTED) return true

      const checkedOutBy = sessionStorage.getItem('checkedOutBy')
      const checkedOutDt = sessionStorage.getItem('checkedOutDt')

      if (checkedOutBy) {
        console.log('checkin ', sessionStorage.getItem('BCREG-nrNum'), sessionStorage.getItem('BCREG-NRL'), sessionStorage.getItem('BCREG-phoneNumber'), sessionStorage.getItem('BCREG-emailAddress')) // eslint-disable-line
        await this.axios.patch(`${this.namexUrl()}/namerequests/${nrId}/checkin`, {
          checkedOutBy: checkedOutBy,
          checkedOutDt: checkedOutDt
        }, {
          headers: { 'Content-Type': 'application/json' }
        })
        sessionStorage.removeItem('checkedOutBy')
        sessionStorage.removeItem('checkedOutDt')

        return true
      }
    } catch (err) {
      const msg = await this.handleApiError(err, 'Could not checkin name request')
      console.error('checkinNameRequest() =', msg) // eslint-disable-line no-console
      await errorModule.setAppError({ id: 'checkin-name-requests-error', error: msg } as ErrorI)
      return false
    }
  }
  static async checkoutNameRequest (nrId: number): Promise<boolean> {
    try {
      const checkedOutBy = sessionStorage.getItem('checkedOutBy')
      const checkedOutDt = sessionStorage.getItem('checkedOutDt')

      let response: any
      if (checkedOutBy) {
        console.log('checkOut ', sessionStorage.getItem('BCREG-nrNum'), sessionStorage.getItem('BCREG-NRL'), sessionStorage.getItem('BCREG-phoneNumber'), sessionStorage.getItem('BCREG-emailAddress')) // eslint-disable-line
        response = await this.axios.patch(`${this.namexUrl()}/namerequests/${nrId}/checkout`, {
          checkedOutBy: checkedOutBy,
          checkedOutDt: checkedOutDt
        }, {
          headers: { 'Content-Type': 'application/json' }
        })
      } else {
        response = await this.axios.patch(`${this.namexUrl()}/namerequests/${nrId}/checkout`, {}, {
          headers: { 'Content-Type': 'application/json' }
        })
      }

      const data = response.data || { checkedOutBy: null, checkedOutDt: null }
      sessionStorage.setItem('checkedOutBy', data.checkedOutBy)
      sessionStorage.setItem('checkedOutDt', data.checkedOutDt)

      return true
    } catch (err) {
      const msg = await this.handleApiError(err, 'Could not checkout name request')
      console.error('checkoutNameRequest() =', msg) // eslint-disable-line no-console
      await errorModule.setAppError({ id: 'checkout-name-requests-error', error: msg } as ErrorI)
      return false
    }
  }
  static async completePayment (nrId: number, paymentId: number, action: string): Promise<NameRequestPayment> {
    const paymentResponse: NameRequestPayment = {
      paymentSuccess: false
    }

    try {
      console.log('completePayment ', sessionStorage.getItem('BCREG-nrNum'), sessionStorage.getItem('BCREG-NRL'), sessionStorage.getItem('BCREG-phoneNumber'), sessionStorage.getItem('BCREG-emailAddress')) // eslint-disable-line
      const response = await this.axios.patch(
        `${this.namexUrl()}/payments/${nrId}/payment/${paymentId}/${action}`,
        {},
        { headers: { 'Content-Type': 'application/json' } }
      )

      if (response?.status === OK) {
        paymentResponse.payment = response.data
        paymentResponse.httpStatusCode = response.status.toString()
        paymentResponse.paymentSuccess = true
      } else {
        // eslint-disable-next-line no-console
        console.error('completePayment(), status was not 200, response =', response)
        paymentResponse.httpStatusCode = response.status.toString()
        paymentResponse.paymentSuccess = false
      }

      return paymentResponse
    } catch (err) {
      const msg = await this.handleApiError(err, 'Could not complete payment')
      console.error('completePayment() =', msg) // eslint-disable-line no-console
      await errorModule.setAppError({ id: 'complete-payment-error', error: msg } as ErrorI)
      return null
    }
  }
  static async downloadOutputs (nrId: number): Promise<void> {
    try {
      const url = `${this.namexUrl()}/namerequests/${nrId}/result`
      const headers = { 'Accept': 'application/pdf' }

      // Request PDF for specified id
      const response: any = await this.axios.get(url, { headers: headers, responseType: 'blob' as 'json' })

      // Create a new blob object with mime-type explicitly set, otherwise only Chrome works
      const blob = new Blob([response.data], { type: 'application/pdf' })

      // IE doesn't allow using a blob object directly as link href, so use msSaveOrOpenBlob
      if (window.navigator && window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveOrOpenBlob(blob)
      } else {
        // for other browsers, create a link pointing to the ObjectURL containing the blob
        const url = window.URL.createObjectURL(blob)
        const a = window.document.createElement('a')
        window.document.body.appendChild(a)
        a.setAttribute('style', 'display: none')
        a.href = url
        a.download = 'Name Request Results'
        a.click()
        window.URL.revokeObjectURL(url)
        a.remove()
      }
    } catch (error) {
      console.error('downloadOutputs() =', error) // eslint-disable-line no-console

      await errorModule.setAppError(
        { id: 'download-pdf-error', error: 'Could not download PDF' } as ErrorI
      )
    }
  }
  static async fetchStats (): Promise<StatsI> {
    try {
      let response = await this.axios.get(`${this.namexUrl()}/statistics`)
      if (response?.status === OK && response?.data) return response.data
      throw new Error(`Invalid response = ${response}`)
    } catch (err) {
      const msg = await this.handleApiError(err, 'Could not fetch stats')
      console.error('fetchStats() =', msg) // eslint-disable-line no-console
      return null
    }
  }
  static async getNameRequest (handleError: boolean): Promise<NameRequestI> {
    try {
      const { CancelToken } = Axios
      const source = CancelToken.source()
      console.log('get ', sessionStorage.getItem('BCREG-nrNum'), sessionStorage.getItem('BCREG-NRL'), sessionStorage.getItem('BCREG-phoneNumber'), sessionStorage.getItem('BCREG-emailAddress')) // eslint-disable-line
      const response = await this.axios.get(`${this.namexUrl()}/namerequests`, {
        cancelToken: source.token
      })
      if (response?.status === OK && response?.data) return response.data
      throw new Error(`Invalid response = ${response}`)
    } catch (err) {
      if (handleError) {
        const msg = await this.handleApiError(err, 'Could not get name request')
        console.error('getNameRequest() =', msg) // eslint-disable-line no-console
        await errorModule.setAppError({ id: 'get-name-request-error', error: msg } as ErrorI)
      }
      return null
    }
  }
  static async searchNameRequests (
    params: AdvancedSearchI,
    handleError: boolean,
    isCountCheck: boolean = false
  ): Promise<AdvancedSearchResultsI> {
    try {
      const token = sessionStorage.getItem('KEYCLOAK_TOKEN')
      const headers = {
        Authorization: `Bearer ${token}`,
        'Accept': 'application/pdf'
      }

      // Integer to determine the amount of NR selections for the query to return.
      // Is 0 when we only want the NR count.
      let rowCount = isCountCheck ? 0 : 1000

      const response = await this.axios.get(`${this.namexUrl()}/requests?rows=${rowCount}`, {
        params,
        headers
      })

      if (response?.status === OK && response?.data) return response.data
      throw new Error(`Invalid response = ${response}`)
    } catch (err) {
      if (handleError) {
        const msg = await this.handleApiError(err, 'Could not find Name Requests.')
        console.error('searchNameRequests() =', msg) // eslint-disable-line no-console
        await errorModule.setAppError({ id: 'search-name-request-error', error: msg } as ErrorI)
      }
      return null
    }
  }
  static async handleApiError (err: any, defaultMessage = ''): Promise<string> {
    if ((err as AxiosError).isAxiosError !== undefined) {
      let message = ''
      const responseData = err?.response?.data
      const hasResponseData = !!responseData

      if (hasResponseData && responseData instanceof Blob) {
        // Handle any cases where the API error response is a Blob (eg, request for PDF receipt fails).
        const errorText = await responseData.text()
        const errorJson = JSON.parse(errorText)
        if (errorJson?.message) {
          message = `${err.toString()} [ ${errorJson.message} ]`
        }
      } else if (hasResponseData && responseData instanceof String) {
        // Handle any cases where the API error response is a String.
        message = `${err.toString()} [ ${responseData.toString()} ]`
      } else if (hasResponseData && responseData.message) {
        // Handle any cases where the API error response in an object (eg, { message: 'Ipsum lorem dolor' }).
        message += responseData.message
        message = `${err.toString()} [ ${responseData.message} ]`
      } else if (defaultMessage) {
        // Handle any other cases.
        message = `${err.toString()} [ ${defaultMessage} ]`
      } else {
        return err.toString()
      }

      // Replace line breaks with HTML line breaks.
      return message.replace(/(?:\r\n|\r|\n)/g, '<br>')
    } else {
      // Handle non-axios error (ie, probably a JS error).
      return (err?.toString() || defaultMessage)
    }
  }
  static async nameAnalysis (params: NewRequestNameSearchI, xpro: boolean): Promise<AnalysisJSONI> {
    const { CancelToken } = Axios
    const source = CancelToken.source()
    const url = xpro ? 'xpro-name-analysis' : 'name-analysis'
    const response = await this.axios.get(`${this.namexUrl()}/${url}`, {
      params,
      cancelToken: source.token,
      timeout: ANALYSIS_TIMEOUT_MS
    })
    if (response?.status === OK && response?.data) return response.data
    // TODO: change how this is handled
    throw new Error(`Invalid response = ${response}`)
  }
  static async patchNameRequests (nrId: number, action: NrAction, nr: NameRequestI): Promise<any> {
    try {
      // const nr = getters.getEditNameReservation
      const requestData: any = nr && await this.addRequestActionComment(action, nr)
      console.log('patch ', sessionStorage.getItem('BCREG-nrNum'), sessionStorage.getItem('BCREG-NRL'), sessionStorage.getItem('BCREG-phoneNumber'), sessionStorage.getItem('BCREG-emailAddress')) // eslint-disable-line
      const response: any = requestData &&
        await this.axios.patch(`${this.namexUrl()}/namerequests/${nrId}/edit`, requestData, {
          headers: { 'Content-Type': 'application/json' }
        })

      if (response?.data && [OK, CREATED, ACCEPTED, NO_CONTENT].includes(response?.status)) {
        return response.data
      }
      throw new Error(`Invalid response = ${response}`)
    } catch (err) {
      const msg = await this.handleApiError(err, 'Could not patch name requests')
      console.error('patchNameRequests() =', msg) // eslint-disable-line no-console
      await errorModule.setAppError({ id: 'patch-name-requests-error', error: msg } as ErrorI)
      return null
    }
  }
  static async patchNameRequestsByAction (nrId: number, action: NrAction): Promise<any> {
    try {
      console.log('patch by action ', sessionStorage.getItem('BCREG-nrNum'), sessionStorage.getItem('BCREG-NRL'), sessionStorage.getItem('BCREG-phoneNumber'), sessionStorage.getItem('BCREG-emailAddress')) // eslint-disable-line
      const response: any = await this.axios.patch(`${this.namexUrl()}/namerequests/${nrId}/${action}`, {}, {
        headers: { 'Content-Type': 'application/json' }
      })

      if (response?.data && [OK, CREATED, ACCEPTED, NO_CONTENT].includes(response?.status)) {
        return response.data
      }

      throw new Error(`Invalid response = ${response}`)
    } catch (err) {
      const msg = await this.handleApiError(err, 'Could not patch name requests by action')
      console.error('patchNameRequestsByAction() =', msg) // eslint-disable-line no-console
      await errorModule.setAppError({ id: 'patch-name-requests-by-action-error', error: msg } as ErrorI)
      return null
    }
  }
  static async postNameRequests (action: NrAction, data: NameRequestI): Promise<NameRequestI> {
    try {
      if (!data) throw new Error('postNameRequests() - invalid data') // safety check

      // set to null (in case these were set from a previous user action) since this will be a new nr/nrl
      sessionStorage.setItem('BCREG-NRL', null)
      sessionStorage.setItem('BCREG-nrNum', null)
      sessionStorage.setItem('BCREG-emailAddress', null)
      sessionStorage.setItem('BCREG-phoneNumber', null)

      const requestData: any = data && await this.addRequestActionComment(action, data)
      if (!requestData) throw new Error('postNameRequests() - invalid request data') // safety check

      console.log('post ', sessionStorage.getItem('BCREG-nrNum'), sessionStorage.getItem('BCREG-NRL'), sessionStorage.getItem('BCREG-phoneNumber'), sessionStorage.getItem('BCREG-emailAddress')) // eslint-disable-line
      const response: any = requestData && await this.axios.post(`${this.namexUrl()}/namerequests`, requestData, {
        headers: { 'Content-Type': 'application/json' }
      })
      if (response?.data && [OK, CREATED, ACCEPTED, NO_CONTENT].includes(response?.status)) {
        return response.data
      }
      throw new Error(`Invalid response = ${response}`)
    } catch (err) {
      // extra logging to help find errors
      err?.message && console.log('postNameRequests(), message =', err.message) // eslint-disable-line no-console
      err?.request && console.log('postNameRequests(), request =', err.request) // eslint-disable-line no-console
      err?.response && console.log('postNameRequests(), response =', err.response) // eslint-disable-line no-console
      const msg = await this.handleApiError(err, 'Could not post name requests')
      console.error('postNameRequests() =', msg) // eslint-disable-line no-console
      await errorModule.setAppError({ id: 'post-name-requests-error', error: msg } as ErrorI)
      return null
    }
  }
  static async putNameReservation (
    nrId: number,
    action: NrAction,
    data: NameRequestI
  ): Promise<NameRequestI> {
    try {
      const requestData: any = data && await this.addRequestActionComment(action, data)
      console.log('put ', sessionStorage.getItem('BCREG-nrNum'), sessionStorage.getItem('BCREG-NRL'), sessionStorage.getItem('BCREG-phoneNumber'), sessionStorage.getItem('BCREG-emailAddress')) // eslint-disable-line
      const response: any = requestData && await this.axios.put(
        `${this.namexUrl()}/namerequests/${nrId}`,
        requestData,
        { headers: { 'Content-Type': 'application/json' } }
      )
      if (response?.data && [OK, CREATED, ACCEPTED, NO_CONTENT].includes(response?.status)) {
        return response.data
      }
      throw new Error(`Invalid response = ${response}`)
    } catch (err) {
      const msg = await this.handleApiError(err, 'Could not put name reservation')
      console.error('putNameReservation() =', msg) // eslint-disable-line no-console
      await errorModule.setAppError({ id: 'put-name-reservation-error', error: msg } as ErrorI)
      return null
    }
  }
  static async rollbackNameRequest (nrId: number): Promise<boolean> {
    try {
      // safety checks
      if (!nrId) {
        // NB: use console.error to capture issues to Sentry
        // ultimately this should never happen
        console.error('rollbackNameRequest(), invalid NR id') // eslint-disable-line no-console
        return false
      }
      console.log('rollback ', sessionStorage.getItem('BCREG-nrNum'), sessionStorage.getItem('BCREG-NRL'), sessionStorage.getItem('BCREG-phoneNumber'), sessionStorage.getItem('BCREG-emailAddress')) // eslint-disable-line
      const response = await this.axios.patch(
        `${this.namexUrl()}/namerequests/${nrId}/rollback/${RollbackActions.CANCEL}`,
        {},
        { headers: { 'Content-Type': 'application/json' } }
      )

      if (!response || response.status !== OK) {
        throw new Error(`Status was not 200, response = ${response}`)
      }
      return true
    } catch (err) {
      const msg = await this.handleApiError(err, 'Could not rollback name request')
      console.error('rollbackNameRequest() =', msg) // eslint-disable-line no-console
      await errorModule.setAppError({ id: 'rollback-name-request-error', error: msg } as ErrorI)
      return false
    }
  }
}
